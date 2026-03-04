'use client'

import { useState, useRef, useEffect } from 'react'
import type { KanbanColumn, KanbanTask } from '@/lib/types/tasks'
import { PRIORITY_CONFIG } from '@/lib/types/tasks'
import { getUserColor, getUserInitials, type ColorOverrides } from '@/lib/user-colors'
import { X, Mic, MicOff, Send, Bot, Loader2, Check, Pencil, Plus, Sparkles } from 'lucide-react'

interface AITaskModalProps {
  open: boolean
  onClose: () => void
  columns: KanbanColumn[]
  teamMembers: string[]
  colorOverrides: ColorOverrides
  onCreateTask: (columnId: string, title: string, extraFields?: Partial<KanbanTask>) => Promise<any>
  currentUser: string
}

interface ChatMessage {
  role: 'user' | 'ai'
  content: string
  taskData?: ParsedTask | null
}

interface ParsedTask {
  title: string
  description: string | null
  assignee: string | null
  priority: 'low' | 'medium' | 'high' | 'urgent'
  due_date: string | null
  column: string | null
  visibility: 'everyone' | 'private'
  estimated_hours: number | null
  raci_responsible: string | null
  raci_accountable: string | null
  raci_consulted: string | null
  raci_informed: string | null
  rock_tags: string[]
}

export function AITaskModal({
  open, onClose, columns, teamMembers, colorOverrides, onCreateTask, currentUser,
}: AITaskModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [listening, setListening] = useState(false)
  const [pendingTask, setPendingTask] = useState<ParsedTask | null>(null)
  const [editingTask, setEditingTask] = useState(false)
  const [editFields, setEditFields] = useState<ParsedTask | null>(null)
  const [created, setCreated] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const recognitionRef = useRef<any>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, pendingTask])

  useEffect(() => {
    if (open) {
      setMessages([])
      setPendingTask(null)
      setEditingTask(false)
      setCreated(false)
      setInput('')
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [open])

  // Web Speech API
  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      alert('Voice input is not supported in this browser. Please use Chrome or Edge.')
      return
    }

    const recognition = new SR()
    recognition.continuous = false
    recognition.interimResults = false
    recognition.lang = 'en-US'

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript
      setInput(prev => prev ? prev + ' ' + transcript : transcript)
      setListening(false)
    }

    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
  }

  const stopListening = () => {
    recognitionRef.current?.stop()
    setListening(false)
  }

  const sendMessage = async (text?: string) => {
    const msg = text || input.trim()
    if (!msg || loading) return

    const userMsg: ChatMessage = { role: 'user', content: msg }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/ai/task-creator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role === 'ai' ? 'assistant' : 'user', content: m.content })),
          teamMembers,
          columns: columns.map(c => c.title),
        }),
      })

      const data = await res.json()

      if (data.error) {
        setMessages(prev => [...prev, { role: 'ai', content: 'Sorry, there was an error: ' + data.error }])
      } else if (data.type === 'task' && data.task) {
        const task = data.task as ParsedTask
        setPendingTask(task)
        setEditFields(task)
        setMessages(prev => [...prev, {
          role: 'ai',
          content: data.summary || 'Here is the task I created from your description:',
          taskData: task,
        }])
      } else if (data.type === 'message') {
        setMessages(prev => [...prev, { role: 'ai', content: data.content }])
      } else {
        setMessages(prev => [...prev, { role: 'ai', content: JSON.stringify(data) }])
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: 'ai', content: 'Connection error. Please try again.' }])
    }

    setLoading(false)
  }

  const handleConfirm = async () => {
    if (!editFields) return

    // Find column
    const sortedCols = [...columns].sort((a, b) => a.sort_order - b.sort_order)
    const col = editFields.column
      ? columns.find(c => c.title.toLowerCase() === editFields.column!.toLowerCase()) || sortedCols[0]
      : sortedCols[0]

    const extra: Partial<KanbanTask> = {
      priority: editFields.priority || 'medium',
      description: editFields.description || undefined,
      assignee: editFields.assignee || undefined,
      due_date: editFields.due_date || undefined,
      visibility: editFields.visibility || 'everyone',
      estimated_hours: editFields.estimated_hours || undefined,
      raci_responsible: editFields.raci_responsible || undefined,
      raci_accountable: editFields.raci_accountable || undefined,
      raci_consulted: editFields.raci_consulted ? [editFields.raci_consulted] : undefined,
      raci_informed: editFields.raci_informed ? [editFields.raci_informed] : undefined,
      rock_tags: editFields.rock_tags?.length ? editFields.rock_tags : undefined,
    } as any

    await onCreateTask(col.id, editFields.title, extra)
    setCreated(true)
    setPendingTask(null)

    // Auto-reset for next task after brief pause
    setTimeout(() => {
      setCreated(false)
      setMessages(prev => [...prev, { role: 'ai', content: 'Task created! Describe another task or close when done.' }])
    }, 1500)
  }

  if (!open) return null

  const sortedCols = [...columns].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative w-full max-w-xl max-h-[85vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-np-blue/5 to-violet-50">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-np-blue/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-np-blue" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-np-dark">AI Task Creator</h3>
              <p className="text-[10px] text-gray-400">Speak or type to create tasks</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[200px]">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <Bot className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-xs text-gray-500 mb-2">Tell me about the task you need to create.</p>
              <p className="text-[10px] text-gray-400 max-w-xs mx-auto">
                Try: "Create a high priority task for Shane to configure VR headsets by Friday. He is responsible and I am accountable."
              </p>
              <div className="flex flex-wrap justify-center gap-1.5 mt-4">
                {[
                  'Set up meeting room by Monday',
                  'Review marketing copy, assign to Shane, high priority',
                  'Personal task: update my certifications',
                ].map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(ex)}
                    className="text-[9px] px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-gray-500 hover:bg-np-blue/5 hover:border-np-blue/20 hover:text-np-blue transition-colors"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'ai' && (
                <div className="w-6 h-6 rounded-full bg-np-blue/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <Bot className="w-3.5 h-3.5 text-np-blue" />
                </div>
              )}
              <div className={`max-w-[80%] ${msg.role === 'user' ? 'bg-np-blue text-white' : 'bg-gray-50 text-np-dark'} rounded-xl px-3.5 py-2.5`}>
                <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded-full bg-np-blue/10 flex items-center justify-center flex-shrink-0">
                <Loader2 className="w-3.5 h-3.5 text-np-blue animate-spin" />
              </div>
              <div className="bg-gray-50 rounded-xl px-3.5 py-2.5">
                <p className="text-xs text-gray-400">Thinking...</p>
              </div>
            </div>
          )}

          {created && (
            <div className="flex justify-center py-2">
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-full px-4 py-2">
                <Check className="w-4 h-4 text-green-600" />
                <span className="text-xs font-medium text-green-700">Task created!</span>
              </div>
            </div>
          )}

          <div ref={chatEndRef} />
        </div>

        {/* Task Preview Card */}
        {pendingTask && editFields && !created && (
          <div className="mx-4 mb-3 bg-white border border-np-blue/20 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold text-np-blue uppercase tracking-wider">Task Preview</span>
              <button
                onClick={() => setEditingTask(!editingTask)}
                className="text-[10px] text-gray-400 hover:text-np-dark flex items-center gap-0.5"
              >
                <Pencil className="w-3 h-3" /> {editingTask ? 'Close' : 'Edit'}
              </button>
            </div>

            {editingTask ? (
              /* Editable fields */
              <div className="space-y-2">
                <input value={editFields.title} onChange={e => setEditFields({ ...editFields, title: e.target.value })}
                  className="w-full text-xs font-semibold border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30"
                  placeholder="Title" />
                <textarea value={editFields.description || ''} onChange={e => setEditFields({ ...editFields, description: e.target.value || null })}
                  className="w-full text-[10px] border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 resize-none" rows={2}
                  placeholder="Description" />
                <div className="grid grid-cols-3 gap-2">
                  <select value={editFields.assignee || ''} onChange={e => setEditFields({ ...editFields, assignee: e.target.value || null })}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none">
                    <option value="">Assignee</option>
                    {teamMembers.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <select value={editFields.priority} onChange={e => setEditFields({ ...editFields, priority: e.target.value as any })}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none">
                    {Object.keys(PRIORITY_CONFIG).map(k => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <input type="date" value={editFields.due_date || ''} onChange={e => setEditFields({ ...editFields, due_date: e.target.value || null })}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select value={editFields.column || ''} onChange={e => setEditFields({ ...editFields, column: e.target.value || null })}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none">
                    <option value="">Column (first)</option>
                    {sortedCols.map(c => <option key={c.id} value={c.title}>{c.title}</option>)}
                  </select>
                  <select value={editFields.visibility} onChange={e => setEditFields({ ...editFields, visibility: e.target.value as any })}
                    className="text-[10px] border border-gray-200 rounded px-1.5 py-1.5 focus:outline-none">
                    <option value="everyone">Team visible</option>
                    <option value="private">Personal</option>
                  </select>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {['raci_responsible', 'raci_accountable', 'raci_consulted', 'raci_informed'].map(role => {
                    const label = role.split('_')[1][0].toUpperCase()
                    return (
                      <div key={role}>
                        <label className="text-[8px] font-bold text-gray-400 block mb-0.5">{label}</label>
                        <select value={(editFields as any)[role] || ''}
                          onChange={e => setEditFields({ ...editFields, [role]: e.target.value || null })}
                          className="w-full text-[9px] border border-gray-200 rounded px-1 py-1 focus:outline-none">
                          <option value="">--</option>
                          {teamMembers.map(m => <option key={m} value={m}>{m.split(' ')[0]}</option>)}
                        </select>
                      </div>
                    )
                  })}
                </div>
                {editFields.estimated_hours != null && (
                  <input type="number" step="0.5" value={editFields.estimated_hours || ''}
                    onChange={e => setEditFields({ ...editFields, estimated_hours: e.target.value ? parseFloat(e.target.value) : null })}
                    className="text-[10px] border border-gray-200 rounded px-2 py-1.5 w-24 focus:outline-none" placeholder="Est. hours" />
                )}
              </div>
            ) : (
              /* Read-only preview */
              <div>
                <p className="text-xs font-semibold text-np-dark mb-1">{editFields.title}</p>
                {editFields.description && <p className="text-[10px] text-gray-500 mb-2">{editFields.description}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {editFields.priority && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: PRIORITY_CONFIG[editFields.priority].bg, color: PRIORITY_CONFIG[editFields.priority].color }}>
                      {editFields.priority}
                    </span>
                  )}
                  {editFields.assignee && (
                    <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 flex items-center gap-1">
                      <div className="w-3.5 h-3.5 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: getUserColor(editFields.assignee, colorOverrides).bg }}>
                        <span className="text-[6px] font-bold" style={{ color: getUserColor(editFields.assignee, colorOverrides).text }}>
                          {getUserInitials(editFields.assignee)}
                        </span>
                      </div>
                      {editFields.assignee}
                    </span>
                  )}
                  {editFields.due_date && (
                    <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                      Due {new Date(editFields.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  )}
                  {editFields.column && (
                    <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">{editFields.column}</span>
                  )}
                  {editFields.visibility === 'private' && (
                    <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-violet-50 text-violet-600">Personal</span>
                  )}
                  {editFields.estimated_hours && (
                    <span className="text-[8px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">{editFields.estimated_hours}h</span>
                  )}
                </div>
                {/* RACI display */}
                {(editFields.raci_responsible || editFields.raci_accountable || editFields.raci_consulted || editFields.raci_informed) && (
                  <div className="flex gap-1 mt-2">
                    {[
                      { key: 'R', val: editFields.raci_responsible, color: '#2563EB' },
                      { key: 'A', val: editFields.raci_accountable, color: '#DC2626' },
                      { key: 'C', val: editFields.raci_consulted, color: '#D97706' },
                      { key: 'I', val: editFields.raci_informed, color: '#6B7280' },
                    ].filter(r => r.val).map(r => (
                      <span key={r.key} className="text-[8px] font-bold px-1.5 py-0.5 rounded text-white"
                        style={{ background: r.color }}>
                        {r.key}: {r.val!.split(' ')[0]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Confirm / Cancel */}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              <button onClick={handleConfirm}
                className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Create Task
              </button>
              <button onClick={() => { setPendingTask(null); setEditFields(null); setEditingTask(false) }}
                className="px-3 py-2 text-xs text-gray-400 hover:text-gray-600">
                Discard
              </button>
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="px-4 pb-4 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-2">
            {/* Mic button */}
            <button
              onClick={listening ? stopListening : startListening}
              className={`p-2.5 rounded-xl transition-all flex-shrink-0 ${
                listening
                  ? 'bg-red-500 text-white animate-pulse'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-np-dark'
              }`}
              title={listening ? 'Stop recording' : 'Start voice input'}
            >
              {listening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Text input */}
            <input
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={listening ? 'Listening...' : 'Describe a task or ask me anything...'}
              className="flex-1 text-xs border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300"
              disabled={loading}
            />

            {/* Send button */}
            <button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="p-2.5 rounded-xl bg-np-blue text-white hover:bg-np-blue/90 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
          <p className="text-[9px] text-gray-400 mt-1.5 text-center">
            Press mic to speak, or type. Say "create a task for [name] to [do something] by [date]"
          </p>
        </div>
      </div>
    </div>
  )
}
