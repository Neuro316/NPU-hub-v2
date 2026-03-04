'use client'

import { useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useTaskData } from '@/lib/hooks/use-task-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { TaskDetail } from '@/components/tasks/task-detail'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import type { KanbanTask } from '@/lib/types/tasks'
import { Inbox, ArrowLeft, Clock, AlertTriangle, Calendar, CheckCircle2, ListChecks, Lock, Plus } from 'lucide-react'

function groupByDueDate(tasks: KanbanTask[]) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfWeek = new Date(today)
  endOfWeek.setDate(today.getDate() + (7 - today.getDay()))

  const groups: Record<string, KanbanTask[]> = {
    overdue: [],
    today: [],
    thisWeek: [],
    upcoming: [],
    noDueDate: [],
  }

  for (const t of tasks) {
    if (!t.due_date) {
      groups.noDueDate.push(t)
      continue
    }
    const due = new Date(t.due_date)
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate())

    if (dueDay < today) groups.overdue.push(t)
    else if (dueDay.getTime() === today.getTime()) groups.today.push(t)
    else if (dueDay <= endOfWeek) groups.thisWeek.push(t)
    else groups.upcoming.push(t)
  }

  // Sort each group by priority weight then due date
  const priorityWeight = { urgent: 0, high: 1, medium: 2, low: 3 }
  const sorter = (a: KanbanTask, b: KanbanTask) => {
    const pw = (priorityWeight[a.priority] || 2) - (priorityWeight[b.priority] || 2)
    if (pw !== 0) return pw
    if (a.due_date && b.due_date) return new Date(a.due_date).getTime() - new Date(b.due_date).getTime()
    return 0
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort(sorter)
  }

  return groups
}

const SECTION_CONFIG = [
  { key: 'overdue', label: 'Overdue', icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-200' },
  { key: 'today', label: 'Due Today', icon: Clock, color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' },
  { key: 'thisWeek', label: 'Due This Week', icon: Calendar, color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' },
  { key: 'upcoming', label: 'Upcoming', icon: Calendar, color: 'text-gray-500', bg: 'bg-gray-50', border: 'border-gray-200' },
  { key: 'noDueDate', label: 'No Due Date', icon: Inbox, color: 'text-gray-400', bg: 'bg-gray-50', border: 'border-gray-100' },
]

type TabKey = 'all' | 'personal'

function MyTasksInner() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const { members } = useTeamData()
  const {
    columns, tasks, loading, userId,
    addTask, updateTask, deleteTask,
    fetchComments, addComment,
    fetchSubtasks, addSubtask, updateSubtask, deleteSubtask,
    fetchActivity,
  } = useTaskData()

  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null)
  const [activeTab, setActiveTab] = useState<TabKey>('all')

  // Quick-add personal task
  const [addingPersonal, setAddingPersonal] = useState(false)
  const [personalTitle, setPersonalTitle] = useState('')

  const teamMemberNames = members.map(m => m.display_name)
  const currentUser = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Unknown'

  // Filter: my tasks that aren't in a "Done" column
  const doneColumnIds = useMemo(
    () => columns.filter(c => /done|complete/i.test(c.title)).map(c => c.id),
    [columns]
  )

  const myTasks = useMemo(
    () => tasks.filter(t =>
      (t.assignee === currentUser || (t.owner_id === userId && t.visibility === 'private')) &&
      !doneColumnIds.includes(t.column_id)
    ),
    [tasks, currentUser, userId, doneColumnIds]
  )

  const personalTasks = useMemo(
    () => myTasks.filter(t => t.visibility === 'private'),
    [myTasks]
  )

  const teamTasks = useMemo(
    () => myTasks.filter(t => t.visibility !== 'private'),
    [myTasks]
  )

  const activeTasks = activeTab === 'personal' ? personalTasks : myTasks
  const groups = useMemo(() => groupByDueDate(activeTasks), [activeTasks])

  const totalTasks = activeTasks.length
  const overdueCount = groups.overdue.length

  // Quick-add personal task
  const handleAddPersonal = async () => {
    if (!personalTitle.trim() || !columns.length) return
    // Put in first column
    const firstCol = [...columns].sort((a, b) => a.sort_order - b.sort_order)[0]
    await addTask(firstCol.id, personalTitle.trim(), {
      visibility: 'private',
      assignee: currentUser,
    })
    setPersonalTitle('')
    setAddingPersonal(false)
  }

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading your tasks...</div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/tasks" className="text-gray-400 hover:text-np-dark transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <h1 className="text-xl font-semibold text-np-dark">My Tasks</h1>
          </div>
          <p className="text-xs text-gray-400 ml-6">
            {totalTasks} open task{totalTasks !== 1 ? 's' : ''}
            {overdueCount > 0 && (
              <span className="text-red-500 font-medium ml-1">&middot; {overdueCount} overdue</span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs: All / Personal */}
      <div className="flex items-center gap-1 mb-5 border-b border-gray-100">
        <button
          onClick={() => setActiveTab('all')}
          className={`text-xs font-medium px-4 py-2.5 border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-np-blue text-np-blue'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          All Tasks ({myTasks.length})
        </button>
        <button
          onClick={() => setActiveTab('personal')}
          className={`text-xs font-medium px-4 py-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'personal'
              ? 'border-violet-500 text-violet-600'
              : 'border-transparent text-gray-400 hover:text-gray-600'
          }`}
        >
          <Lock className="w-3 h-3" /> Personal ({personalTasks.length})
        </button>

        {/* Quick-add personal task (shows on personal tab) */}
        {activeTab === 'personal' && (
          <div className="ml-auto">
            {addingPersonal ? (
              <div className="flex items-center gap-1.5">
                <input
                  value={personalTitle}
                  onChange={e => setPersonalTitle(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && personalTitle.trim()) handleAddPersonal()
                    if (e.key === 'Escape') { setAddingPersonal(false); setPersonalTitle('') }
                  }}
                  placeholder="Personal task..."
                  className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-300 w-56 placeholder-gray-300"
                  autoFocus
                />
                <button onClick={handleAddPersonal} className="text-[10px] bg-violet-500 text-white px-2.5 py-1.5 rounded-lg font-medium hover:bg-violet-600">Add</button>
                <button onClick={() => { setAddingPersonal(false); setPersonalTitle('') }} className="text-[10px] text-gray-400 px-1">Cancel</button>
              </div>
            ) : (
              <button
                onClick={() => setAddingPersonal(true)}
                className="flex items-center gap-1 text-[10px] font-medium text-violet-500 hover:text-violet-700 px-2 py-1"
              >
                <Plus className="w-3.5 h-3.5" /> Add Personal Task
              </button>
            )}
          </div>
        )}
      </div>

      {/* Empty state */}
      {totalTasks === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          {activeTab === 'personal' ? (
            <>
              <Lock className="w-14 h-14 text-violet-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">No personal tasks</h2>
              <p className="text-sm text-gray-500 mb-4">Personal tasks are private to you. Team members cannot see them.</p>
              <button
                onClick={() => setAddingPersonal(true)}
                className="text-xs bg-violet-500 text-white px-4 py-2 rounded-lg font-medium hover:bg-violet-600"
              >
                Create Personal Task
              </button>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-14 h-14 text-green-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">All clear!</h2>
              <p className="text-sm text-gray-500 mb-4">No open tasks assigned to you.</p>
              <Link href="/tasks" className="text-xs text-np-blue hover:underline font-medium">Back to Board</Link>
            </>
          )}
        </div>
      )}

      {/* Task sections */}
      <div className="space-y-6">
        {SECTION_CONFIG.map(section => {
          const sectionTasks = groups[section.key] || []
          if (sectionTasks.length === 0) return null

          const SectionIcon = section.icon
          return (
            <div key={section.key}>
              <div className={`flex items-center gap-2 mb-2 px-1`}>
                <SectionIcon className={`w-4 h-4 ${section.color}`} />
                <h2 className={`text-xs font-bold uppercase tracking-wider ${section.color}`}>
                  {section.label}
                </h2>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${section.bg} ${section.color}`}>
                  {sectionTasks.length}
                </span>
              </div>

              <div className="space-y-1">
                {sectionTasks.map(task => {
                  const col = columns.find(c => c.id === task.column_id)
                  const priority = PRIORITY_CONFIG[task.priority]
                  const subtaskTotal = task.custom_fields?.subtask_count || 0
                  const subtaskDone = task.custom_fields?.subtask_completed || 0
                  const isPrivate = task.visibility === 'private'

                  return (
                    <button
                      key={task.id}
                      onClick={() => setSelectedTask(task)}
                      className={`w-full text-left bg-white rounded-lg border ${
                        section.key === 'overdue' ? 'border-red-100' : isPrivate ? 'border-violet-100' : 'border-gray-100'
                      } px-4 py-3 hover:shadow-sm hover:border-gray-200 transition-all flex items-center gap-3`}
                    >
                      {/* Priority dot */}
                      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: priority.color }} />

                      {/* Task info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-np-dark truncate">{task.title}</p>
                          {isPrivate && <Lock className="w-3 h-3 text-violet-400 flex-shrink-0" />}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {col && (
                            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: col.color + '15', color: col.color }}>
                              {col.title}
                            </span>
                          )}
                          {subtaskTotal > 0 && (
                            <span className="text-[9px] text-gray-400 flex items-center gap-0.5">
                              <ListChecks className="w-3 h-3" /> {subtaskDone}/{subtaskTotal}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Due date */}
                      {task.due_date && (
                        <span className={`text-[10px] font-medium flex-shrink-0 ${section.key === 'overdue' ? 'text-red-500' : 'text-gray-400'}`}>
                          {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {/* Task Detail Modal */}
      <TaskDetail
        task={selectedTask}
        columns={columns}
        onClose={() => setSelectedTask(null)}
        onUpdate={updateTask}
        onDelete={deleteTask}
        fetchComments={fetchComments}
        addComment={addComment}
        fetchSubtasks={fetchSubtasks}
        addSubtask={addSubtask}
        updateSubtask={updateSubtask}
        deleteSubtask={deleteSubtask}
        fetchActivity={fetchActivity}
        currentUser={currentUser}
        teamMembers={teamMemberNames}
        orgId={currentOrg?.id || ''}
      />
    </div>
  )
}

export default function MyTasksPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading...</div></div>}>
      <MyTasksInner />
    </Suspense>
  )
}
