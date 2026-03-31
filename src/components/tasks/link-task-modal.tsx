'use client'

import { useState } from 'react'
import { X, Search, Link2, CheckCircle2 } from 'lucide-react'
import type { KanbanTask, KanbanColumn } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'

interface LinkTaskModalProps {
  isOpen: boolean
  onClose: () => void
  currentTask: KanbanTask
  allTasks: KanbanTask[]
  columns: KanbanColumn[]
  onLink: (childTaskId: string) => Promise<void>
}

export function LinkTaskModal({ isOpen, onClose, currentTask, allTasks, columns, onLink }: LinkTaskModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [linking, setLinking] = useState(false)

  const eligibleTasks = allTasks.filter(task => {
    if (task.id === currentTask.id) return false
    if (task.parent_task_id === currentTask.id) return false
    if (currentTask.parent_task_id === task.id) return false
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      return task.title.toLowerCase().includes(q) || task.assignee?.toLowerCase().includes(q)
    }
    return true
  })

  const handleLink = async () => {
    if (!selectedTaskId) return
    setLinking(true)
    await onLink(selectedTaskId)
    setLinking(false)
    setSearchQuery('')
    setSelectedTaskId(null)
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-2">
            <Link2 className="w-5 h-5 text-blue-600" />
            <h3 className="text-sm font-bold text-np-dark">Link Task as Subtask</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search tasks..." autoFocus spellCheck={false}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
          </div>
          <p className="text-xs text-gray-500 mt-2">Select a task to link as subtask of &ldquo;{currentTask.title}&rdquo;</p>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {eligibleTasks.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No eligible tasks found</div>
          ) : eligibleTasks.slice(0, 50).map(task => (
            <button key={task.id} onClick={() => setSelectedTaskId(task.id)}
              className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                selectedTaskId === task.id ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-blue-200 hover:bg-gray-50'
              }`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <p className="text-sm font-medium text-np-dark truncate">{task.title}</p>
                    {task.priority && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-medium flex-shrink-0"
                        style={{ backgroundColor: PRIORITY_CONFIG[task.priority]?.bg, color: PRIORITY_CONFIG[task.priority]?.color }}>
                        {PRIORITY_CONFIG[task.priority]?.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {task.assignee && <span>{task.assignee}</span>}
                    {task.assignee && <span className="text-gray-300">&middot;</span>}
                    <span>{columns.find(c => c.id === task.column_id)?.title}</span>
                  </div>
                </div>
                {selectedTaskId === task.id && <CheckCircle2 className="w-5 h-5 text-blue-600 flex-shrink-0" />}
              </div>
            </button>
          ))}
        </div>

        <div className="p-4 border-t flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">{eligibleTasks.length} tasks available</p>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
            <button onClick={handleLink} disabled={!selectedTaskId || linking}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 rounded-lg flex items-center gap-2">
              {linking ? 'Linking...' : <><Link2 className="w-4 h-4" /> Link as Subtask</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
