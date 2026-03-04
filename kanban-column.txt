'use client'

import { useState } from 'react'
import type { KanbanColumn, KanbanTask } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { TaskCard } from './task-card'
import type { ColorOverrides } from '@/lib/user-colors'
import { Plus, MoreHorizontal, Pencil, Trash2, Check, User, Calendar, Lock, Unlock } from 'lucide-react'

interface KanbanColumnProps {
  column: KanbanColumn
  tasks: KanbanTask[]
  teamMembers: string[]
  onTaskClick: (task: KanbanTask) => void
  onAddTask: (columnId: string, title: string, extraFields?: Partial<KanbanTask>) => Promise<any>
  onDragStart: (taskId: string) => void
  onDrop: (columnId: string) => void
  colorOverrides?: ColorOverrides
  onUpdateColumn: (id: string, updates: Partial<KanbanColumn>) => Promise<any>
  onDeleteColumn: (id: string) => Promise<any>
}

export function KanbanColumnView({
  column, tasks, teamMembers, onTaskClick, onAddTask,
  onDragStart, onDrop, onUpdateColumn, onDeleteColumn, colorOverrides,
}: KanbanColumnProps) {
  const [addingTask, setAddingTask] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newAssignee, setNewAssignee] = useState('')
  const [newPriority, setNewPriority] = useState<KanbanTask['priority']>('medium')
  const [newDueDate, setNewDueDate] = useState('')
  const [newPersonal, setNewPersonal] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(column.title)
  const [showMenu, setShowMenu] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const resetForm = () => {
    setNewTitle('')
    setNewAssignee('')
    setNewPriority('medium')
    setNewDueDate('')
    setNewPersonal(false)
    setAddingTask(false)
  }

  const handleAddTask = async () => {
    if (!newTitle.trim()) return
    const extra: Partial<KanbanTask> = { priority: newPriority }
    if (newAssignee) extra.assignee = newAssignee
    if (newDueDate) extra.due_date = newDueDate
    if (newPersonal) extra.visibility = 'private'
    await onAddTask(column.id, newTitle.trim(), extra)
    resetForm()
  }

  const handleSaveTitle = async () => {
    if (editTitle.trim() && editTitle !== column.title) {
      await onUpdateColumn(column.id, { title: editTitle.trim() })
    }
    setEditingTitle(false)
  }

  const sortedTasks = [...tasks].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div
      className={`flex-shrink-0 w-72 bg-gray-50 rounded-xl border transition-colors ${dragOver ? 'border-np-blue bg-np-blue/5' : 'border-transparent'}`}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); onDrop(column.id) }}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
          {editingTitle ? (
            <div className="flex items-center gap-1">
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                className="text-xs font-bold bg-white border border-gray-200 rounded px-1.5 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-np-blue"
                autoFocus
              />
              <button onClick={handleSaveTitle} className="text-green-500"><Check className="w-3.5 h-3.5" /></button>
            </div>
          ) : (
            <span className="text-xs font-bold text-np-dark">{column.title}</span>
          )}
          <span className="text-[10px] text-gray-400 bg-gray-200 rounded-full w-5 h-5 flex items-center justify-center font-medium">
            {tasks.length}
          </span>
        </div>

        <div className="relative">
          <button onClick={() => setShowMenu(!showMenu)} className="text-gray-400 hover:text-gray-600">
            <MoreHorizontal className="w-4 h-4" />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-full mt-1 bg-white border border-gray-100 rounded-lg shadow-lg z-50 w-36">
              <button onClick={() => { setEditingTitle(true); setShowMenu(false) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                <Pencil className="w-3 h-3" /> Rename
              </button>
              <button onClick={() => { if (confirm('Delete column and all tasks?')) onDeleteColumn(column.id); setShowMenu(false) }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-500 flex items-center gap-2">
                <Trash2 className="w-3 h-3" /> Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tasks */}
      <div className="px-2 pb-2 space-y-2 min-h-[60px] max-h-[calc(100vh-280px)] overflow-y-auto">
        {sortedTasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            colorOverrides={colorOverrides}
            onClick={() => onTaskClick(task)}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id) }}
          />
        ))}

        {/* Quick-Add Task with assignee/priority/date/personal */}
        {addingTask ? (
          <div className="bg-white rounded-lg border border-gray-200 p-2.5 space-y-2">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newTitle.trim()) handleAddTask(); if (e.key === 'Escape') resetForm() }}
              placeholder="Task title..."
              className="w-full text-xs border-none focus:outline-none placeholder-gray-300"
              autoFocus
            />

            {/* Quick-assign row */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {/* Assignee */}
              <div className="relative flex items-center">
                <User className="w-3 h-3 text-gray-300 absolute left-1.5 pointer-events-none" />
                <select
                  value={newAssignee}
                  onChange={e => setNewAssignee(e.target.value)}
                  className="text-[10px] border border-gray-200 rounded pl-5 pr-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30 bg-white appearance-none max-w-[100px]"
                >
                  <option value="">Assign</option>
                  {teamMembers.map(m => <option key={m} value={m}>{m.split(' ')[0]}</option>)}
                </select>
              </div>

              {/* Priority pills */}
              <div className="flex gap-0.5">
                {(Object.keys(PRIORITY_CONFIG) as Array<keyof typeof PRIORITY_CONFIG>).map(key => (
                  <button
                    key={key}
                    onClick={() => setNewPriority(key)}
                    className="text-[8px] font-bold px-1.5 py-0.5 rounded transition-all"
                    style={{
                      backgroundColor: PRIORITY_CONFIG[key].bg,
                      color: PRIORITY_CONFIG[key].color,
                      opacity: newPriority === key ? 1 : 0.4,
                      border: newPriority === key ? `1.5px solid ${PRIORITY_CONFIG[key].color}` : '1.5px solid transparent',
                    }}
                  >
                    {key === 'urgent' ? '!!' : key === 'high' ? '!' : key[0].toUpperCase()}
                  </button>
                ))}
              </div>

              {/* Due date */}
              <div className="relative flex items-center">
                <Calendar className="w-3 h-3 text-gray-300 absolute left-1.5 pointer-events-none" />
                <input
                  type="date"
                  value={newDueDate}
                  onChange={e => setNewDueDate(e.target.value)}
                  className="text-[10px] border border-gray-200 rounded pl-5 pr-1 py-1 focus:outline-none focus:ring-1 focus:ring-np-blue/30 w-[110px]"
                />
              </div>

              {/* Personal toggle */}
              <button
                onClick={() => setNewPersonal(!newPersonal)}
                title={newPersonal ? 'Personal (only you can see)' : 'Team-visible'}
                className={`flex items-center gap-0.5 text-[9px] font-medium px-1.5 py-1 rounded border transition-all ${
                  newPersonal
                    ? 'bg-violet-50 border-violet-300 text-violet-600'
                    : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600'
                }`}
              >
                {newPersonal ? <Lock className="w-3 h-3" /> : <Unlock className="w-3 h-3" />}
                {newPersonal ? 'Personal' : 'Team'}
              </button>
            </div>

            {/* Actions */}
            <div className="flex gap-1 pt-0.5">
              <button onClick={handleAddTask} className="text-[10px] bg-np-blue text-white px-2.5 py-1 rounded font-medium hover:bg-np-blue/90">Add</button>
              <button onClick={resetForm} className="text-[10px] text-gray-400 px-2 py-1 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setAddingTask(true)}
            className="w-full flex items-center gap-1.5 px-2 py-2 text-[10px] text-gray-400 hover:text-np-dark hover:bg-white rounded-lg transition-colors"
          >
            <Plus className="w-3.5 h-3.5" /> Add Task
          </button>
        )}
      </div>
    </div>
  )
}
