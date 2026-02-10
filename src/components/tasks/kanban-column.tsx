'use client'

import { useState } from 'react'
import type { KanbanColumn, KanbanTask } from '@/lib/types/tasks'
import { TaskCard } from './task-card'
import { Plus, MoreHorizontal, Pencil, Trash2, Check } from 'lucide-react'

interface KanbanColumnProps {
  column: KanbanColumn
  tasks: KanbanTask[]
  onTaskClick: (task: KanbanTask) => void
  onAddTask: (columnId: string, title: string) => Promise<any>
  onDragStart: (taskId: string) => void
  onDrop: (columnId: string) => void
  onUpdateColumn: (id: string, updates: Partial<KanbanColumn>) => Promise<any>
  onDeleteColumn: (id: string) => Promise<any>
}

export function KanbanColumnView({
  column, tasks, onTaskClick, onAddTask,
  onDragStart, onDrop, onUpdateColumn, onDeleteColumn,
}: KanbanColumnProps) {
  const [addingTask, setAddingTask] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitle, setEditTitle] = useState(column.title)
  const [showMenu, setShowMenu] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  const handleAddTask = async () => {
    if (!newTitle.trim()) return
    await onAddTask(column.id, newTitle.trim())
    setNewTitle('')
    setAddingTask(false)
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
            onClick={() => onTaskClick(task)}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; onDragStart(task.id) }}
          />
        ))}

        {/* Add Task */}
        {addingTask ? (
          <div className="bg-white rounded-lg border border-gray-200 p-2">
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleAddTask(); if (e.key === 'Escape') { setAddingTask(false); setNewTitle('') } }}
              placeholder="Task title..."
              className="w-full text-xs border-none focus:outline-none placeholder-gray-300 mb-2"
              autoFocus
            />
            <div className="flex gap-1">
              <button onClick={handleAddTask} className="text-[10px] bg-np-blue text-white px-2.5 py-1 rounded font-medium">Add</button>
              <button onClick={() => { setAddingTask(false); setNewTitle('') }} className="text-[10px] text-gray-400 px-2 py-1">Cancel</button>
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
