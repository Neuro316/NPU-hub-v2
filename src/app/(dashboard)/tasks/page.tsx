'use client'

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useTaskData } from '@/lib/hooks/use-task-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { KanbanColumnView } from '@/components/tasks/kanban-column'
import { TaskDetail } from '@/components/tasks/task-detail'
import { AvatarColorPicker } from '@/components/tasks/avatar-color-picker'
import { AITaskModal } from '@/components/tasks/ai-task-modal'
import { ProjectManager } from '@/components/tasks/project-manager'
import type { KanbanTask, ViewFilters } from '@/lib/types/tasks'
import { PROJECT_STATUS_CONFIG } from '@/lib/types/tasks'
import type { ColorOverrides } from '@/lib/user-colors'
import {
  Plus, Search, CheckSquare, Inbox, Sparkles, X, Bot, Loader2,
  FolderOpen, Bookmark, Save, ChevronDown, Settings2, SlidersHorizontal,
  CircleDot, LayoutGrid, User, Flag
} from 'lucide-react'
import { notifyTaskMoved } from '@/lib/slack-notifications'

/* ── Dropdown wrapper with click-outside ── */
function Dropdown({ trigger, children, open, onClose }: {
  trigger: React.ReactNode, children: React.ReactNode, open: boolean, onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])
  return (
    <div className="relative" ref={ref}>
      {trigger}
      {open && children}
    </div>
  )
}

function TasksPageInner() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const { members, getSetting, saveSetting } = useTeamData()
  const searchParams = useSearchParams()
  const {
    columns, tasks, projects, savedViews, loading,
    addColumn, updateColumn, deleteColumn,
    addTask, updateTask, deleteTask, moveTask,
    fetchComments, addComment,
    fetchSubtasks, addSubtask, updateSubtask, deleteSubtask,
    fetchActivity,
    addProject, updateProject, deleteProject,
    addSavedView, updateSavedView, deleteSavedView,
    filterTasks,
  } = useTaskData()

  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')

  // Quick-add task
  const [addingTask, setAddingTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const [newTaskColumn, setNewTaskColumn] = useState('')
  const [newTaskAssignee, setNewTaskAssignee] = useState('')
  const [newTaskNotes, setNewTaskNotes] = useState('')
  const [newTaskProject, setNewTaskProject] = useState('')

  // Modals
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [projectManagerOpen, setProjectManagerOpen] = useState(false)

  // Project filter: 'all' | 'none' | project_id
  const [activeProject, setActiveProject] = useState<string>('all')
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false)

  // Saved views
  const [viewsDropdownOpen, setViewsDropdownOpen] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [newViewName, setNewViewName] = useState('')

  // Filters
  const [filterMember, setFilterMember] = useState<string | null>(null)
  const [filterPriority, setFilterPriority] = useState<string | null>(null)
  const [filtersExpanded, setFiltersExpanded] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [aiSearchQuery, setAiSearchQuery] = useState('')
  const [aiSearchResults, setAiSearchResults] = useState<string[] | null>(null)
  const [aiSearching, setAiSearching] = useState(false)
  const [searchMode, setSearchMode] = useState<'text' | 'ai'>('text')

  // Color overrides
  const [colorOverrides, setColorOverrides] = useState<ColorOverrides>({})

  useEffect(() => {
    const saved = getSetting('avatar_colors')
    if (saved) setColorOverrides(saved as ColorOverrides)
  }, [getSetting])

  const handleSaveColors = async (overrides: ColorOverrides) => {
    setColorOverrides(overrides)
    await saveSetting('avatar_colors', overrides)
  }

  // Deep link
  useEffect(() => {
    const taskId = searchParams.get('task')
    if (taskId && tasks.length > 0 && !selectedTask) {
      const found = tasks.find(t => t.id === taskId)
      if (found) setSelectedTask(found)
    }
    const projId = searchParams.get('project')
    if (projId && projects.length > 0) setActiveProject(projId)
  }, [searchParams, tasks, projects, selectedTask])

  const teamMemberNames = members.map(m => m.display_name)
  const currentUser = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Unknown'

  // ─── Task counts ───
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    tasks.forEach(t => {
      const pid = t.project_id || '__none__'
      counts[pid] = (counts[pid] || 0) + 1
    })
    return counts
  }, [tasks])

  // ─── Filtered tasks ───
  const filteredTasks = useMemo(() => {
    let filtered = tasks
    if (activeProject === 'none') filtered = filtered.filter(t => !t.project_id)
    else if (activeProject !== 'all') filtered = filtered.filter(t => t.project_id === activeProject)
    if (filterMember) filtered = filtered.filter(t => t.assignee === filterMember)
    if (filterPriority) filtered = filtered.filter(t => t.priority === filterPriority)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      filtered = filtered.filter(t =>
        t.title.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q) ||
        t.assignee?.toLowerCase().includes(q) || t.priority?.toLowerCase().includes(q) ||
        t.rock_tags?.some(tag => tag.toLowerCase().includes(q))
      )
    }
    if (aiSearchResults) filtered = filtered.filter(t => aiSearchResults.includes(t.id))
    return filtered
  }, [tasks, activeProject, filterMember, filterPriority, searchQuery, aiSearchResults])

  // ─── AI search ───
  const handleAISearch = async () => {
    if (!aiSearchQuery.trim()) return
    setAiSearching(true); setAiSearchResults(null)
    try {
      const taskSummaries = tasks.map(t => ({
        id: t.id, title: t.title, description: t.description?.slice(0, 100),
        assignee: t.assignee, priority: t.priority,
        column: columns.find(c => c.id === t.column_id)?.title,
        due_date: t.due_date, tags: t.rock_tags,
        project: t.project_id ? projects.find(p => p.id === t.project_id)?.name : null,
      }))
      const res = await fetch('/api/ai/task-creator', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Search through these tasks and return ONLY a JSON object with type "search_results" and an array "task_ids" containing the IDs of tasks that match this query: "${aiSearchQuery}"\n\nTasks:\n${JSON.stringify(taskSummaries)}\n\nRespond with ONLY: {"type":"search_results","task_ids":["id1","id2"]}` }],
          teamMembers: teamMemberNames, columns: columns.map(c => c.title),
        }),
      })
      const data = await res.json()
      setAiSearchResults(data.task_ids || [])
    } catch { setAiSearchResults([]) }
    setAiSearching(false)
  }

  const clearAllFilters = () => {
    setSearchQuery(''); setAiSearchQuery(''); setAiSearchResults(null)
    setSearchMode('text'); setFilterMember(null); setFilterPriority(null)
    setActiveProject('all'); setSearchOpen(false)
  }

  // ─── Saved views ───
  const currentFilters: ViewFilters = {
    project_id: activeProject === 'all' ? undefined : (activeProject === 'none' ? null : activeProject),
    assignee: filterMember, priority: filterPriority, search: searchQuery || undefined,
  }

  const handleSaveView = async () => {
    if (!newViewName.trim()) return
    await addSavedView(newViewName.trim(), currentFilters)
    setNewViewName(''); setSavingView(false); setViewsDropdownOpen(false)
  }

  const handleLoadView = (view: typeof savedViews[0]) => {
    const f = view.filters_json as ViewFilters
    if (f.project_id !== undefined) setActiveProject(f.project_id === null ? 'none' : (f.project_id || 'all'))
    if (f.assignee !== undefined) setFilterMember(f.assignee)
    if (f.priority !== undefined) setFilterPriority(f.priority)
    if (f.search) { setSearchQuery(f.search); setSearchOpen(true) }
    setViewsDropdownOpen(false)
  }

  const handleDrop = useCallback(async (targetColumnId: string) => {
    if (!draggedTaskId) return
    const task = tasks.find(t => t.id === draggedTaskId)
    if (!task || task.column_id === targetColumnId) { setDraggedTaskId(null); return }
    const fromCol = columns.find(c => c.id === task.column_id)?.title || ''
    const toCol = columns.find(c => c.id === targetColumnId)?.title || ''
    const colTasks = tasks.filter(t => t.column_id === targetColumnId)
    const maxOrder = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.sort_order)) + 1 : 0
    await moveTask(draggedTaskId, targetColumnId, maxOrder)
    setDraggedTaskId(null)
    if (currentOrg?.id) {
      notifyTaskMoved(currentOrg.id, task.title, task.id, fromCol, toCol, currentUser, task.assignee, {
        responsible: task.custom_fields?.raci_responsible || '',
        accountable: task.custom_fields?.raci_accountable || '',
        consulted: task.custom_fields?.raci_consulted || '',
        informed: task.custom_fields?.raci_informed || '',
      })
    }
  }, [draggedTaskId, tasks, moveTask, columns, currentOrg, currentUser])

  const handleAddColumn = async () => {
    if (!newColTitle.trim()) return
    const colors = ['#6B7280', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#EC4899']
    await addColumn(newColTitle.trim(), colors[columns.length % colors.length])
    setNewColTitle(''); setAddingColumn(false)
  }

  const handleQuickAddTask = async () => {
    if (!newTaskTitle.trim()) return
    const sortedCols = [...columns].sort((a, b) => a.sort_order - b.sort_order)
    const targetCol = newTaskColumn ? columns.find(c => c.id === newTaskColumn) || sortedCols[0] : sortedCols[0]
    if (!targetCol) return
    const extras: Partial<KanbanTask> = { assignee: newTaskAssignee || currentUser, description: newTaskNotes.trim() || undefined }
    const projId = newTaskProject === '__none__' ? undefined : (newTaskProject || (activeProject !== 'all' && activeProject !== 'none' ? activeProject : undefined))
    if (projId) (extras as any).project_id = projId
    await addTask(targetCol.id, newTaskTitle.trim(), extras)
    setNewTaskTitle(''); setAddingTask(false)
    setNewTaskColumn(''); setNewTaskAssignee(''); setNewTaskNotes(''); setNewTaskProject('')
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading tasks...</div></div>
  }

  const sortedCols = [...columns].sort((a, b) => a.sort_order - b.sort_order)
  const activeProjects = projects.filter(p => p.status === 'active')
  const activeProjectObj = projects.find(p => p.id === activeProject)
  const unassignedCount = taskCounts['__none__'] || 0
  const hasActiveFilters = filterMember || filterPriority || activeProject !== 'all' || searchQuery.trim() || aiSearchResults !== null
  const activeFilterCount = [filterMember, filterPriority, activeProject !== 'all' ? activeProject : null, searchQuery.trim() || null].filter(Boolean).length

  return (
    <div>
      {/* ═══════════════════════════════════════════════════════
          COMMAND BAR - single clean row
          ═══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 mb-4">
        {/* Title cluster */}
        <div className="mr-2">
          <h1 className="text-lg font-bold text-np-dark leading-tight">Tasks</h1>
          <p className="text-[10px] text-gray-400 tabular-nums">{filteredTasks.length}{hasActiveFilters ? ` of ${tasks.length}` : ''}</p>
        </div>

        {/* ── Project selector ── */}
        <Dropdown
          open={projectDropdownOpen}
          onClose={() => setProjectDropdownOpen(false)}
          trigger={
            <button onClick={() => setProjectDropdownOpen(!projectDropdownOpen)}
              className="flex items-center gap-2 h-9 px-3 rounded-lg border border-gray-200 bg-white hover:border-gray-300 transition-all text-xs font-medium text-np-dark group">
              {activeProjectObj ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full ring-2 ring-white" style={{ backgroundColor: activeProjectObj.color }} />
                  <span className="max-w-[140px] truncate">{activeProjectObj.name}</span>
                </>
              ) : activeProject === 'none' ? (
                <>
                  <span className="w-2.5 h-2.5 rounded-full bg-gray-300 ring-2 ring-white" />
                  <span>Unassigned</span>
                </>
              ) : (
                <>
                  <LayoutGrid className="w-3.5 h-3.5 text-gray-400" />
                  <span>All Projects</span>
                </>
              )}
              <ChevronDown className="w-3 h-3 text-gray-400 group-hover:text-gray-600 transition-colors" />
            </button>
          }
        >
          <div className="absolute left-0 top-full mt-1.5 w-64 bg-white rounded-xl border border-gray-200 shadow-xl shadow-gray-200/50 z-40 overflow-hidden">
            <div className="px-3 pt-3 pb-2">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Projects</p>
            </div>
            <div className="max-h-[280px] overflow-y-auto">
              {/* All Tasks */}
              <button onClick={() => { setActiveProject('all'); setProjectDropdownOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                  activeProject === 'all' ? 'bg-np-blue/5 text-np-blue font-semibold' : 'text-gray-700 hover:bg-gray-50'
                }`}>
                <LayoutGrid className="w-3.5 h-3.5 flex-shrink-0" style={{ color: activeProject === 'all' ? '#2563EB' : '#9CA3AF' }} />
                <span className="flex-1 text-left">All Tasks</span>
                <span className="text-[10px] text-gray-400 tabular-nums">{tasks.length}</span>
              </button>
              {/* Each project */}
              {activeProjects.map(p => (
                <button key={p.id} onClick={() => { setActiveProject(p.id); setProjectDropdownOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                    activeProject === p.id ? 'bg-np-blue/5 text-np-blue font-semibold' : 'text-gray-700 hover:bg-gray-50'
                  }`}>
                  <span className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: p.color + '18' }}>
                    <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: p.color }} />
                  </span>
                  <span className="flex-1 text-left truncate">{p.name}</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{taskCounts[p.id] || 0}</span>
                </button>
              ))}
              {/* No Project */}
              {unassignedCount > 0 && (
                <button onClick={() => { setActiveProject('none'); setProjectDropdownOpen(false) }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors ${
                    activeProject === 'none' ? 'bg-np-blue/5 text-np-blue font-semibold' : 'text-gray-500 hover:bg-gray-50'
                  }`}>
                  <span className="w-3.5 h-3.5 rounded flex-shrink-0 flex items-center justify-center bg-gray-100">
                    <span className="w-2 h-2 rounded-sm bg-gray-300" />
                  </span>
                  <span className="flex-1 text-left">No Project</span>
                  <span className="text-[10px] text-gray-400 tabular-nums">{unassignedCount}</span>
                </button>
              )}
            </div>
            <div className="border-t border-gray-100 p-1.5">
              <button onClick={() => { setProjectManagerOpen(true); setProjectDropdownOpen(false) }}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-gray-500 hover:text-np-dark hover:bg-gray-50 rounded-lg transition-colors">
                <Settings2 className="w-3.5 h-3.5" /> Manage Projects
              </button>
            </div>
          </div>
        </Dropdown>

        {/* ── Divider ── */}
        <div className="w-px h-5 bg-gray-200" />

        {/* ── Saved Views ── */}
        <Dropdown
          open={viewsDropdownOpen}
          onClose={() => { setViewsDropdownOpen(false); setSavingView(false) }}
          trigger={
            <button onClick={() => setViewsDropdownOpen(!viewsDropdownOpen)}
              className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition-all ${
                viewsDropdownOpen ? 'bg-gray-100 text-np-dark' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}>
              <Bookmark className="w-3.5 h-3.5" />
              Views
              {savedViews.length > 0 && (
                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-200 text-[9px] font-bold text-gray-600">{savedViews.length}</span>
              )}
            </button>
          }
        >
          <div className="absolute left-0 top-full mt-1.5 w-60 bg-white rounded-xl border border-gray-200 shadow-xl shadow-gray-200/50 z-40 overflow-hidden">
            <div className="px-3 pt-3 pb-2">
              <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Saved Views</p>
            </div>
            <div className="max-h-[200px] overflow-y-auto">
              {savedViews.map(v => (
                <div key={v.id} className="flex items-center group px-1.5">
                  <button onClick={() => handleLoadView(v)}
                    className="flex-1 flex items-center gap-2 px-2 py-2 text-xs text-gray-700 hover:bg-gray-50 rounded-lg text-left truncate transition-colors">
                    <CircleDot className="w-3 h-3 text-gray-300 flex-shrink-0" />
                    {v.name}
                  </button>
                  <button onClick={async () => { await deleteSavedView(v.id) }}
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 transition-all">
                    <X className="w-3 h-3 text-gray-300 hover:text-red-500" />
                  </button>
                </div>
              ))}
              {savedViews.length === 0 && !savingView && (
                <p className="px-3 py-4 text-[11px] text-gray-400 text-center">No saved views yet</p>
              )}
            </div>
            <div className="border-t border-gray-100 p-1.5">
              {savingView ? (
                <div className="flex gap-1.5 px-1.5 py-1">
                  <input value={newViewName} onChange={e => setNewViewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveView(); if (e.key === 'Escape') setSavingView(false) }}
                    placeholder="View name..." autoFocus
                    className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                  <button onClick={handleSaveView} className="px-2.5 py-1.5 bg-np-blue text-white rounded-lg text-[10px] font-medium hover:bg-np-blue/90">
                    Save
                  </button>
                </div>
              ) : (
                <button onClick={() => setSavingView(true)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-np-blue hover:bg-np-blue/5 rounded-lg transition-colors">
                  <Save className="w-3.5 h-3.5" /> Save current filters
                </button>
              )}
            </div>
          </div>
        </Dropdown>

        {/* ── Filters toggle ── */}
        <button onClick={() => setFiltersExpanded(!filtersExpanded)}
          className={`flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium transition-all ${
            hasActiveFilters
              ? 'bg-blue-50 text-np-blue border border-np-blue/20'
              : filtersExpanded ? 'bg-gray-100 text-np-dark' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
          }`}>
          <SlidersHorizontal className="w-3.5 h-3.5" />
          Filter
          {activeFilterCount > 0 && (
            <span className="w-4 h-4 flex items-center justify-center rounded-full bg-np-blue text-[9px] font-bold text-white">{activeFilterCount}</span>
          )}
        </button>

        {/* ── Search toggle ── */}
        {searchOpen ? (
          <div className="flex-1 flex items-center gap-1.5 h-9 bg-white border border-gray-200 rounded-lg px-3 max-w-sm">
            {searchMode === 'ai' ? (
              <Bot className="w-3.5 h-3.5 text-np-blue/50 flex-shrink-0" />
            ) : (
              <Search className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
            )}
            <input
              value={searchMode === 'ai' ? aiSearchQuery : searchQuery}
              onChange={e => searchMode === 'ai' ? setAiSearchQuery(e.target.value) : setSearchQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'ai') handleAISearch(); if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); setAiSearchQuery(''); setAiSearchResults(null) } }}
              placeholder={searchMode === 'ai' ? "Ask AI to find tasks..." : "Search tasks..."}
              className="flex-1 text-xs bg-transparent focus:outline-none placeholder-gray-300"
              autoFocus
            />
            <div className="flex items-center gap-0.5">
              <button onClick={() => setSearchMode(searchMode === 'ai' ? 'text' : 'ai')}
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors ${
                  searchMode === 'ai' ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600'
                }`}>
                {searchMode === 'ai' ? 'AI' : 'TXT'}
              </button>
              {searchMode === 'ai' && (
                <button onClick={handleAISearch} disabled={aiSearching || !aiSearchQuery.trim()} className="p-0.5">
                  {aiSearching ? <Loader2 className="w-3 h-3 animate-spin text-np-blue" /> : <Sparkles className="w-3 h-3 text-np-blue" />}
                </button>
              )}
              <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setAiSearchQuery(''); setAiSearchResults(null) }} className="p-0.5">
                <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setSearchOpen(true)}
            className="flex items-center gap-1.5 h-9 px-3 rounded-lg text-xs font-medium text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-all">
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
          </button>
        )}

        {/* ── Spacer ── */}
        <div className="flex-1" />

        {/* ── Right actions ── */}
        <AvatarColorPicker teamMembers={teamMemberNames} colorOverrides={colorOverrides} onSave={handleSaveColors} />

        <Link href="/tasks/my-tasks"
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-medium text-np-dark hover:border-gray-300 transition-all">
          <Inbox className="w-3.5 h-3.5" /> <span className="hidden sm:inline">My Tasks</span>
        </Link>

        <button onClick={() => setAddingTask(true)}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-200 bg-white text-xs font-medium text-np-dark hover:border-gray-300 transition-all">
          <Plus className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Task</span>
        </button>

        <button onClick={() => setAiModalOpen(true)}
          className="flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-np-blue text-white text-xs font-medium hover:bg-np-blue/90 transition-all shadow-sm shadow-np-blue/20">
          <Sparkles className="w-3.5 h-3.5" /> <span className="hidden sm:inline">AI</span>
        </button>
      </div>

      {/* ═══════════════════════════════════════════════════════
          FILTER BAR - expandable
          ═══════════════════════════════════════════════════════ */}
      {(filtersExpanded || hasActiveFilters) && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Member pills */}
          <div className="flex items-center gap-1">
            <User className="w-3 h-3 text-gray-300 mr-0.5" />
            {teamMemberNames.map(m => (
              <button key={m} onClick={() => setFilterMember(filterMember === m ? null : m)}
                className={`text-[10px] px-2 py-1 rounded-md font-medium transition-all ${
                  filterMember === m
                    ? 'bg-np-blue text-white shadow-sm shadow-np-blue/20'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}>
                {m.split(' ')[0]}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-gray-200" />

          {/* Priority pills */}
          <div className="flex items-center gap-1">
            <Flag className="w-3 h-3 text-gray-300 mr-0.5" />
            {(['urgent', 'high', 'medium', 'low'] as const).map(p => (
              <button key={p} onClick={() => setFilterPriority(filterPriority === p ? null : p)}
                className={`text-[10px] px-2 py-1 rounded-md font-medium capitalize transition-all ${
                  filterPriority === p
                    ? 'bg-np-blue text-white shadow-sm shadow-np-blue/20'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}>
                {p}
              </button>
            ))}
          </div>

          {/* Clear all */}
          {hasActiveFilters && (
            <>
              <div className="w-px h-4 bg-gray-200" />
              <button onClick={clearAllFilters}
                className="text-[10px] text-gray-400 hover:text-red-500 font-medium flex items-center gap-1 transition-colors">
                <X className="w-3 h-3" /> Clear all
              </button>
            </>
          )}

          {/* AI search feedback */}
          {aiSearchResults !== null && (
            <span className="text-[10px] text-gray-400 ml-2">
              {aiSearchResults.length === 0 ? 'No AI matches' : `AI: ${aiSearchResults.length} match${aiSearchResults.length !== 1 ? 'es' : ''}`}
            </span>
          )}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          QUICK ADD / ADD COLUMN
          ═══════════════════════════════════════════════════════ */}
      {addingTask && (
        <div className="mb-3 bg-white border border-gray-200 rounded-xl p-4 max-w-md shadow-sm">
          <h3 className="text-xs font-semibold text-np-dark mb-2">Quick Add Task</h3>
          <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleQuickAddTask(); if (e.key === 'Escape') setAddingTask(false) }}
            placeholder="Task title..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 mb-2" autoFocus />
          <textarea value={newTaskNotes} onChange={e => setNewTaskNotes(e.target.value)}
            placeholder="Notes (optional)..." rows={2}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 resize-none" />
          <div className="grid grid-cols-2 gap-2 mb-2">
            <select value={newTaskColumn} onChange={e => setNewTaskColumn(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
              <option value="">Column: {sortedCols[0]?.title || ''}</option>
              {sortedCols.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
            <select value={newTaskAssignee} onChange={e => setNewTaskAssignee(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none">
              <option value="">Me ({currentUser.split(' ')[0]})</option>
              {teamMemberNames.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <select value={newTaskProject} onChange={e => setNewTaskProject(e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 mb-2 focus:outline-none">
            <option value="">{activeProjectObj ? `Project: ${activeProjectObj.name}` : 'No Project'}</option>
            <option value="__none__">No Project</option>
            {activeProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button onClick={handleQuickAddTask} className="btn-primary text-xs py-1.5 px-4">Add</button>
            <button onClick={() => { setAddingTask(false); setNewTaskTitle(''); setNewTaskColumn(''); setNewTaskAssignee(''); setNewTaskNotes(''); setNewTaskProject('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {addingColumn && (
        <div className="mb-3 bg-white border border-gray-200 rounded-xl p-4 max-w-xs shadow-sm">
          <h3 className="text-xs font-semibold text-np-dark mb-2">New Column</h3>
          <input value={newColTitle} onChange={e => setNewColTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddColumn(); if (e.key === 'Escape') { setAddingColumn(false); setNewColTitle('') } }}
            placeholder="Column name..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 placeholder-gray-300 mb-2" autoFocus />
          <div className="flex gap-2">
            <button onClick={handleAddColumn} className="btn-primary text-xs py-1.5 px-4">Add</button>
            <button onClick={() => { setAddingColumn(false); setNewColTitle('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════
          KANBAN BOARD
          ═══════════════════════════════════════════════════════ */}
      {columns.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <CheckSquare className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Task Manager</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Organize work with a kanban board. Create columns, add tasks, drag to move them.
          </p>
          <button onClick={() => setAddingColumn(true)} className="btn-primary">Create First Column</button>
        </div>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {sortedCols.map(col => (
            <KanbanColumnView
              key={col.id}
              column={col}
              tasks={filteredTasks.filter(t => t.column_id === col.id)}
              teamMembers={teamMemberNames}
              colorOverrides={colorOverrides}
              onTaskClick={setSelectedTask}
              onAddTask={addTask}
              onDragStart={setDraggedTaskId}
              onDrop={handleDrop}
              onUpdateColumn={updateColumn}
              onDeleteColumn={deleteColumn}
            />
          ))}
          {!addingColumn && (
            <button onClick={() => setAddingColumn(true)}
              className="flex-shrink-0 w-72 flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors min-h-[200px]">
              <Plus className="w-4 h-4" /> Add Column
            </button>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      <TaskDetail
        task={selectedTask} columns={columns}
        onClose={() => setSelectedTask(null)}
        onUpdate={updateTask} onDelete={deleteTask}
        fetchComments={fetchComments} addComment={addComment}
        fetchSubtasks={fetchSubtasks} addSubtask={addSubtask}
        updateSubtask={updateSubtask} deleteSubtask={deleteSubtask}
        fetchActivity={fetchActivity}
        currentUser={currentUser} teamMembers={teamMemberNames}
        orgId={currentOrg?.id || ''} projects={projects}
      />

      <AITaskModal
        open={aiModalOpen} onClose={() => setAiModalOpen(false)}
        columns={columns} teamMembers={teamMemberNames}
        colorOverrides={colorOverrides} onCreateTask={addTask}
        currentUser={currentUser}
      />

      <ProjectManager
        open={projectManagerOpen} onClose={() => setProjectManagerOpen(false)}
        projects={projects} onAdd={addProject} onUpdate={updateProject}
        onDelete={deleteProject} taskCounts={taskCounts}
      />
    </div>
  )
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading tasks...</div></div>}>
      <TasksPageInner />
    </Suspense>
  )
}
