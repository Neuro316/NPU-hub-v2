'use client'

import type { KanbanTask } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { Clock, MessageSquare, Link2, GripVertical } from 'lucide-react'

interface TaskCardProps {
  task: KanbanTask
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}

export function TaskCard({ task, onClick, onDragStart }: TaskCardProps) {
  const priority = PRIORITY_CONFIG[task.priority]
  const commentCount = task.custom_fields?.comment_count || 0
  const linkCount = task.custom_fields?.link_count || 0
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-100 p-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group"
    >
      {/* Priority + Assignee */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ backgroundColor: priority.bg, color: priority.color }}
        >
          {priority.label}
        </span>
        {task.assignee && (
          <div className="w-6 h-6 rounded-full bg-np-blue/10 flex items-center justify-center" title={task.assignee}>
            <span className="text-[9px] font-bold text-np-blue">
              {task.assignee.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>
        )}
      </div>

      {/* Title */}
      <p className="text-xs font-semibold text-np-dark leading-snug mb-1.5">{task.title}</p>

      {/* Description preview */}
      {task.description && (
        <p className="text-[10px] text-gray-400 line-clamp-2 leading-snug mb-2">{task.description}</p>
      )}

      {/* Footer: due date, comments, links */}
      <div className="flex items-center gap-2 text-[9px] text-gray-400">
        {task.due_date && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Clock className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {commentCount > 0 && (
          <span className="flex items-center gap-0.5">
            <MessageSquare className="w-3 h-3" /> {commentCount}
          </span>
        )}
        {linkCount > 0 && (
          <span className="flex items-center gap-0.5">
            <Link2 className="w-3 h-3" /> {linkCount}
          </span>
        )}
      </div>
    </div>
  )
}
