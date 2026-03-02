'use client'

import type { KanbanTask } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { Clock, MessageSquare, Link2, Zap, AlertTriangle } from 'lucide-react'

interface TaskCardProps {
  task: KanbanTask
  onClick: () => void
  onDragStart: (e: React.DragEvent) => void
}

const RACI_COLORS: Record<string, string> = {
  R: '#2563EB',
  A: '#DC2626',
  C: '#D97706',
  I: '#6B7280',
}

export function TaskCard({ task, onClick, onDragStart }: TaskCardProps) {
  const priority = PRIORITY_CONFIG[task.priority]
  const commentCount = task.custom_fields?.comment_count || 0
  const linkCount = task.custom_fields?.link_count || 0
  const isOverdue = task.due_date && new Date(task.due_date) < new Date()
  const hasBlockers = task.blocked_by && task.blocked_by.length > 0

  // RACI data — check both new columns and legacy custom_fields
  const raciR = task.raci_responsible || task.custom_fields?.raci_responsible
  const raciA = task.raci_accountable || task.custom_fields?.raci_accountable
  const raciC = (task.raci_consulted?.length ? task.raci_consulted[0] : null) || task.custom_fields?.raci_consulted
  const raciI = (task.raci_informed?.length ? task.raci_informed[0] : null) || task.custom_fields?.raci_informed
  const hasRaci = raciR || raciA || raciC || raciI

  // Rock tags
  const rockTags = task.rock_tags?.length ? task.rock_tags : []

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onClick={onClick}
      className={`bg-white rounded-lg border p-3 cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group ${
        hasBlockers ? 'border-red-200 bg-red-50/30' : 'border-gray-100'
      }`}
    >
      {/* Rock Tags */}
      {rockTags.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {rockTags.map((tag, i) => (
            <span key={i} className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 uppercase tracking-wider">
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Priority + AI badge + Assignee */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <span
            className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ backgroundColor: priority.bg, color: priority.color }}
          >
            {priority.label}
          </span>
          {task.ai_generated && (
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 flex items-center gap-0.5">
              <Zap className="w-2.5 h-2.5" /> AI
            </span>
          )}
        </div>
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

      {/* Blocker warning */}
      {hasBlockers && (
        <div className="flex items-center gap-1 text-[9px] text-red-600 font-medium mb-2 bg-red-50 px-2 py-1 rounded">
          <AlertTriangle className="w-3 h-3" /> Blocked by {task.blocked_by.length} task{task.blocked_by.length > 1 ? 's' : ''}
        </div>
      )}

      {/* RACI badges */}
      {hasRaci && (
        <div className="flex gap-1 mb-2">
          {[
            { key: 'R', value: raciR },
            { key: 'A', value: raciA },
            { key: 'C', value: raciC },
            { key: 'I', value: raciI },
          ].filter(r => r.value).map(r => (
            <span key={r.key}
              title={`${r.key === 'R' ? 'Responsible' : r.key === 'A' ? 'Accountable' : r.key === 'C' ? 'Consulted' : 'Informed'}: ${r.value}`}
              className="inline-flex items-center gap-0.5 text-[8px] font-bold px-1 py-0.5 rounded text-white"
              style={{ background: RACI_COLORS[r.key] }}>
              {r.key}
              <span className="font-normal opacity-80 text-[7px]">
                {String(r.value).split(' ')[0]}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Footer: hours, due date, comments, links */}
      <div className="flex items-center gap-2 text-[9px] text-gray-400">
        {task.estimated_hours && (
          <span className="flex items-center gap-0.5 font-medium">
            {task.estimated_hours}h
            {task.actual_hours != null && (
              <span className={task.actual_hours > task.estimated_hours ? 'text-red-500' : 'text-green-600'}>
                /{task.actual_hours}h
              </span>
            )}
          </span>
        )}
        {task.due_date && (
          <span className={`flex items-center gap-0.5 ${isOverdue ? 'text-red-500 font-medium' : ''}`}>
            <Clock className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
        {task.milestone && (
          <span className="text-amber-500 font-bold">◆</span>
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
        {task.sequence_order != null && (
          <span className="ml-auto text-[8px] text-gray-300 font-mono">#{task.sequence_order}</span>
        )}
      </div>
    </div>
  )
}
