'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Tasks — Task management with team assignment
// Route: /crm/tasks
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, CheckCircle2, Clock, AlertTriangle, Users,
  Filter, Search, Calendar, Brain, X
} from 'lucide-react'
import { fetchTasks, createTask, updateTask } from '@/lib/crm-client'
import type { CrmTask } from '@/types/crm'

const PRIORITY_CONFIG = {
  urgent: { color: '#dc2626', bg: '#fef2f2', label: 'Urgent' },
  high: { color: '#d97706', bg: '#fffbeb', label: 'High' },
  medium: { color: '#2563eb', bg: '#eff6ff', label: 'Medium' },
  low: { color: '#6b7280', bg: '#f3f4f6', label: 'Low' },
}

const STATUS_CONFIG = {
  todo: { color: '#6b7280', label: 'To Do' },
  in_progress: { color: '#2563eb', label: 'In Progress' },
  done: { color: '#059669', label: 'Done' },
  cancelled: { color: '#9ca3af', label: 'Cancelled' },
}

function TaskRow({ task, onComplete, onStatusChange }: {
  task: CrmTask; onComplete: () => void; onStatusChange: (status: string) => void
}) {
  const pri = PRIORITY_CONFIG[task.priority]
  const sta = STATUS_CONFIG[task.status as keyof typeof STATUS_CONFIG]
  const contactName = task.contact
    ? `${(task.contact as any).first_name} ${(task.contact as any).last_name}`
    : null
  const isOverdue = task.due_date && task.status !== 'done' && new Date(task.due_date) < new Date()

  return (
    <div className={`flex items-center gap-3 px-4 py-3 border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors ${task.status === 'done' ? 'opacity-50' : ''}`}>
      {/* Checkbox */}
      <button
        onClick={onComplete}
        className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all ${
          task.status === 'done' ? 'bg-green-500 border-green-500' : 'border-gray-100 hover:border-np-blue'
        }`}
      >
        {task.status === 'done' && <CheckCircle2 size={12} className="text-white" />}
      </button>

      {/* Priority dot */}
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: pri.color }} title={pri.label} />

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-medium ${task.status === 'done' ? 'line-through text-gray-400' : 'text-np-dark'}`}>
          {task.title}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {contactName && (
            <Link href={`/crm/contacts?id=${task.contact_id}`} className="text-[10px] text-np-blue hover:underline">
              {contactName}
            </Link>
          )}
          {task.source !== 'manual' && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-np-blue/8 text-np-blue font-medium flex items-center gap-0.5">
              <Brain size={7} /> {task.source}
            </span>
          )}
        </div>
      </div>

      {/* Status */}
      <select
        value={task.status}
        onChange={e => onStatusChange(e.target.value)}
        className="text-[10px] bg-gray-50 border-none rounded-md px-2 py-1 font-medium"
        style={{ color: sta.color }}
      >
        <option value="todo">To Do</option>
        <option value="in_progress">In Progress</option>
        <option value="done">Done</option>
        <option value="cancelled">Cancelled</option>
      </select>

      {/* Assigned */}
      <span className="text-[10px] text-gray-400 w-24 truncate text-right">
        {(task.assigned_member as any)?.display_name || '--'}
      </span>

      {/* Due date */}
      <span className={`text-[10px] w-20 text-right ${isOverdue ? 'text-red-500 font-semibold' : 'text-gray-400'}`}>
        {task.due_date
          ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          : '--'}
        {isOverdue && ' ⚠'}
      </span>
    </div>
  )
}

export default function TasksPage() {
  const [tasks, setTasks] = useState<CrmTask[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [priorityFilter, setPriorityFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' as const, due_date: '' })

  useEffect(() => {
    const filters: any = {}
    if (statusFilter) filters.status = statusFilter
    fetchTasks(filters).then(setTasks).catch(console.error).finally(() => setLoading(false))
  }, [statusFilter])

  const handleComplete = async (task: CrmTask) => {
    const newStatus = task.status === 'done' ? 'todo' : 'done'
    try {
      await updateTask(task.id, { status: newStatus })
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status: newStatus } : t))
    } catch (e) { console.error(e) }
  }

  const handleStatusChange = async (taskId: string, status: string) => {
    try {
      await updateTask(taskId, { status: status as any })
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: status as any } : t))
    } catch (e) { console.error(e) }
  }

  const filtered = tasks.filter(t => {
    if (priorityFilter && t.priority !== priorityFilter) return false
    if (search && !t.title.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const overdue = filtered.filter(t => t.due_date && t.status !== 'done' && new Date(t.due_date) < new Date())

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
          />
        </div>

        <div className="flex gap-1">
          {['', 'todo', 'in_progress', 'done'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'
              }`}
            >
              {s ? STATUS_CONFIG[s as keyof typeof STATUS_CONFIG]?.label : 'All'}
            </button>
          ))}
        </div>

        <div className="flex gap-1">
          {['', 'urgent', 'high', 'medium', 'low'].map(p => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                priorityFilter === p ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400'
              }`}
            >
              {p || 'Priority'}
            </button>
          ))}
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors"
        >
          <Plus size={13} /> Add Task
        </button>
      </div>

      {/* Overdue alert */}
      {overdue.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={14} className="text-red-500" />
          <span className="text-xs font-medium text-red-700">{overdue.length} overdue task{overdue.length > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Stats */}
      <div className="flex gap-3">
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs">
          <span className="text-gray-400">Open: </span>
          <span className="font-bold text-np-dark">{filtered.filter(t => t.status === 'todo' || t.status === 'in_progress').length}</span>
        </div>
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs">
          <span className="text-gray-400">Done: </span>
          <span className="font-bold text-green-600">{filtered.filter(t => t.status === 'done').length}</span>
        </div>
        <div className="px-3 py-2 rounded-lg border border-gray-100 bg-white text-xs">
          <span className="text-gray-400">AI-Created: </span>
          <span className="font-bold text-np-blue">{filtered.filter(t => t.source !== 'manual').length}</span>
        </div>
      </div>

      {/* Task List */}
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-gray-50/50">
          <div className="w-5" />
          <div className="w-2" />
          <span className="flex-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Task</span>
          <span className="w-24 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Status</span>
          <span className="w-24 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-right">Assigned</span>
          <span className="w-20 text-[9px] font-semibold uppercase tracking-wider text-gray-400 text-right">Due</span>
        </div>
        {loading ? (
          <div className="py-8 text-center text-xs text-gray-400">Loading tasks...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle2 size={32} className="mx-auto text-gray-400/30 mb-3" />
            <p className="text-sm text-gray-400">No tasks found</p>
          </div>
        ) : (
          filtered.map(t => (
            <TaskRow
              key={t.id}
              task={t}
              onComplete={() => handleComplete(t)}
              onStatusChange={s => handleStatusChange(t.id, s)}
            />
          ))
        )}
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Task</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50"><X size={14} /></button>
            </div>
            <div className="space-y-3">
              <input
                value={newTask.title}
                onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
                placeholder="Task title"
                className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
              />
              <textarea
                value={newTask.description}
                onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
                placeholder="Description (optional)"
                rows={3}
                className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Priority</label>
                  <select
                    value={newTask.priority}
                    onChange={e => setNewTask(p => ({ ...p, priority: e.target.value as any }))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Due Date</label>
                  <input
                    type="date"
                    value={newTask.due_date}
                    onChange={e => setNewTask(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg"
                  />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
              <button
                disabled={!newTask.title}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg disabled:opacity-40 transition-colors"
              >
                Create Task
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
