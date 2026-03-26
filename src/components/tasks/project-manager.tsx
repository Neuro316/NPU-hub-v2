'use client'

import { useState } from 'react'
import type { Project } from '@/lib/types/tasks'
import { PROJECT_COLORS, PROJECT_STATUS_CONFIG } from '@/lib/types/tasks'
import { X, Plus, Pencil, Trash2, FolderOpen, Check } from 'lucide-react'

interface ProjectManagerProps {
  open: boolean
  onClose: () => void
  projects: Project[]
  onAdd: (name: string, extras?: Partial<Project>) => Promise<any>
  onUpdate: (id: string, updates: Partial<Project>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  taskCounts: Record<string, number>
}

export function ProjectManager({ open, onClose, projects, onAdd, onUpdate, onDelete, taskCounts }: ProjectManagerProps) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#3B82F6')
  const [status, setStatus] = useState<Project['status']>('active')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (!open) return null

  const resetForm = () => {
    setName('')
    setDescription('')
    setColor('#3B82F6')
    setStatus('active')
    setAdding(false)
    setEditingId(null)
  }

  const handleAdd = async () => {
    if (!name.trim()) return
    await onAdd(name.trim(), { description: description.trim() || null, color, status })
    resetForm()
  }

  const startEdit = (p: Project) => {
    setEditingId(p.id)
    setName(p.name)
    setDescription(p.description || '')
    setColor(p.color)
    setStatus(p.status)
    setAdding(false)
  }

  const handleUpdate = async () => {
    if (!editingId || !name.trim()) return
    await onUpdate(editingId, { name: name.trim(), description: description.trim() || null, color, status })
    resetForm()
  }

  const handleDelete = async (id: string) => {
    await onDelete(id)
    setConfirmDelete(null)
  }

  const activeProjects = projects.filter(p => p.status === 'active')
  const otherProjects = projects.filter(p => p.status !== 'active')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-lg max-h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <FolderOpen className="w-5 h-5 text-np-blue" />
            <h3 className="text-sm font-bold text-np-dark">Manage Projects</h3>
            <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">{projects.length}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Add/Edit Form */}
          {(adding || editingId) && (
            <div className="mb-4 bg-gray-50 rounded-xl p-4 space-y-3">
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Project name..."
                spellCheck autoCapitalize="words" autoCorrect="on" autoComplete="off"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20" autoFocus />
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Description (optional)..."
                spellCheck autoCapitalize="sentences" autoCorrect="on"
                rows={2} className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-none" />
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  {PROJECT_COLORS.map(c => (
                    <button key={c.value} onClick={() => setColor(c.value)}
                      className="w-6 h-6 rounded-full border-2 transition-all flex items-center justify-center"
                      style={{ backgroundColor: c.value, borderColor: color === c.value ? c.value : 'transparent' }}>
                      {color === c.value && <Check className="w-3 h-3 text-white" />}
                    </button>
                  ))}
                </div>
                <select value={status} onChange={e => setStatus(e.target.value as Project['status'])}
                  className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none">
                  {Object.entries(PROJECT_STATUS_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>{v.label}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <button onClick={editingId ? handleUpdate : handleAdd}
                  className="px-4 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
                  {editingId ? 'Update' : 'Create'}
                </button>
                <button onClick={resetForm} className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
              </div>
            </div>
          )}

          {/* Add button */}
          {!adding && !editingId && (
            <button onClick={() => setAdding(true)}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 mb-4 border-2 border-dashed border-gray-200 rounded-xl text-xs text-gray-400 hover:text-np-blue hover:border-np-blue/30 transition-colors">
              <Plus className="w-4 h-4" /> New Project
            </button>
          )}

          {/* Active Projects */}
          {activeProjects.length > 0 && (
            <div className="mb-4">
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Active Projects</h4>
              <div className="space-y-1.5">
                {activeProjects.map(p => (
                  <ProjectRow key={p.id} project={p} taskCount={taskCounts[p.id] || 0}
                    onEdit={() => startEdit(p)}
                    confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {/* Other Projects */}
          {otherProjects.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Other</h4>
              <div className="space-y-1.5">
                {otherProjects.map(p => (
                  <ProjectRow key={p.id} project={p} taskCount={taskCounts[p.id] || 0}
                    onEdit={() => startEdit(p)}
                    confirmDelete={confirmDelete} setConfirmDelete={setConfirmDelete} onDelete={handleDelete} />
                ))}
              </div>
            </div>
          )}

          {projects.length === 0 && !adding && (
            <div className="text-center py-8">
              <FolderOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-xs text-gray-400">No projects yet. Create one to group your tasks.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProjectRow({ project: p, taskCount, onEdit, confirmDelete, setConfirmDelete, onDelete }: {
  project: Project, taskCount: number, onEdit: () => void,
  confirmDelete: string | null, setConfirmDelete: (id: string | null) => void,
  onDelete: (id: string) => void
}) {
  const statusCfg = PROJECT_STATUS_CONFIG[p.status]
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-white border border-gray-100 rounded-xl hover:border-gray-200 transition-colors group">
      <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-np-dark truncate">{p.name}</span>
          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: statusCfg.bg, color: statusCfg.color }}>
            {statusCfg.label}
          </span>
        </div>
        {p.description && <p className="text-[10px] text-gray-400 truncate mt-0.5">{p.description}</p>}
      </div>
      <span className="text-[10px] text-gray-400 tabular-nums">{taskCount} tasks</span>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onEdit} className="p-1 rounded hover:bg-gray-100">
          <Pencil className="w-3 h-3 text-gray-400" />
        </button>
        {confirmDelete === p.id ? (
          <div className="flex gap-1">
            <button onClick={() => onDelete(p.id)} className="text-[9px] px-1.5 py-0.5 bg-red-500 text-white rounded">Yes</button>
            <button onClick={() => setConfirmDelete(null)} className="text-[9px] px-1.5 py-0.5 bg-gray-200 rounded">No</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(p.id)} className="p-1 rounded hover:bg-red-50">
            <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-500" />
          </button>
        )}
      </div>
    </div>
  )
}
