'use client'

import { useState, useCallback } from 'react'
import { useTaskData } from '@/lib/hooks/use-task-data'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { KanbanColumnView } from '@/components/tasks/kanban-column'
import { TaskDetail } from '@/components/tasks/task-detail'
import type { KanbanTask } from '@/lib/types/tasks'
import { Plus, Filter, Bot, CheckSquare } from 'lucide-react'
import { notifyTaskMoved } from '@/lib/slack-notifications'

export default function TasksPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()
  const { members } = useTeamData()
  const {
    columns, tasks, loading,
    addColumn, updateColumn, deleteColumn,
    addTask, updateTask, deleteTask, moveTask,
    fetchComments, addComment,
  } = useTaskData()

  const [selectedTask, setSelectedTask] = useState<KanbanTask | null>(null)
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null)
  const [addingColumn, setAddingColumn] = useState(false)
  const [newColTitle, setNewColTitle] = useState('')
  const [filterMember, setFilterMember] = useState<string | null>(null)
  const currentUser = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Unknown'

  const teamMemberNames = members.map(m => m.display_name)

  const handleDrop = useCallback(async (targetColumnId: string) => {
    if (!draggedTaskId) return
    const task = tasks.find(t => t.id === draggedTaskId)
    if (!task || task.column_id === targetColumnId) {
      setDraggedTaskId(null)
      return
    }

    const fromCol = columns.find(c => c.id === task.column_id)?.title || ''
    const toCol = columns.find(c => c.id === targetColumnId)?.title || ''
    const colTasks = tasks.filter(t => t.column_id === targetColumnId)
    const maxOrder = colTasks.length > 0 ? Math.max(...colTasks.map(t => t.sort_order)) + 1 : 0
    await moveTask(draggedTaskId, targetColumnId, maxOrder)
    setDraggedTaskId(null)

    // Slack notify
    if (currentOrg?.id) {
      const raciRoles = {
        responsible: task.custom_fields?.raci_responsible || '',
        accountable: task.custom_fields?.raci_accountable || '',
        consulted: task.custom_fields?.raci_consulted || '',
        informed: task.custom_fields?.raci_informed || '',
      }
      notifyTaskMoved(currentOrg.id, task.title, task.id, fromCol, toCol, currentUser, task.assignee, raciRoles)
    }
  }, [draggedTaskId, tasks, moveTask, columns, currentOrg, currentUser])

  const handleAddColumn = async () => {
    if (!newColTitle.trim()) return
    const colors = ['#6B7280', '#3B82F6', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444', '#EC4899']
    const color = colors[columns.length % colors.length]
    await addColumn(newColTitle.trim(), color)
    setNewColTitle('')
    setAddingColumn(false)
  }

  const filteredTasks = filterMember
    ? tasks.filter(t => t.assignee === filterMember)
    : tasks


  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading tasks...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Task Manager</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentOrg?.name} Â· {columns.length} columns Â· {tasks.length} tasks
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setAddingColumn(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50 transition-colors">
            <Plus className="w-3.5 h-3.5" /> Add Column
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors">
            <Bot className="w-3.5 h-3.5" /> AI Tasks
          </button>
        </div>
      </div>

      {/* Add Column */}
      {addingColumn && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 max-w-xs">
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

      {/* Filter Bar */}
      <div className="flex items-center gap-2 mb-4">
        <Filter className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Filter:</span>
        <button
          onClick={() => setFilterMember(null)}
          className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${!filterMember ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          All
        </button>
        {teamMemberNames.map(m => (
          <button key={m}
            onClick={() => setFilterMember(filterMember === m ? null : m)}
            className={`text-[10px] px-2.5 py-1 rounded-full font-medium transition-colors ${filterMember === m ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {m}
          </button>
        ))}
      </div>

      {/* Empty State */}
      {columns.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <CheckSquare className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Task Manager</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Organize work with a kanban board. Create columns, add tasks, drag to move them,
            assign team members, and track progress.
          </p>
          <button onClick={() => setAddingColumn(true)} className="btn-primary">Create First Column</button>
        </div>
      )}

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4">
        {[...columns].sort((a, b) => a.sort_order - b.sort_order).map(col => (
          <KanbanColumnView
            key={col.id}
            column={col}
            tasks={filteredTasks.filter(t => t.column_id === col.id)}
            onTaskClick={setSelectedTask}
            onAddTask={addTask}
            onDragStart={setDraggedTaskId}
            onDrop={handleDrop}
            onUpdateColumn={updateColumn}
            onDeleteColumn={deleteColumn}
          />
        ))}

        {/* Quick add column */}
        {columns.length > 0 && !addingColumn && (
          <button
            onClick={() => setAddingColumn(true)}
            className="flex-shrink-0 w-72 flex items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-dark hover:border-gray-300 transition-colors min-h-[200px]">
            <Plus className="w-4 h-4" /> Add Column
          </button>
        )}
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
        currentUser={currentUser}
        teamMembers={teamMemberNames}
        orgId={currentOrg?.id || ''}
      />
    </div>
  )
}
