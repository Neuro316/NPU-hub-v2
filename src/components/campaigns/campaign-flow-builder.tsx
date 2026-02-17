'use client'

// ═══════════════════════════════════════════════════════════════
// Campaign Flow Builder — Visual drag-and-drop automation editor
// Nodes: trigger, email, sms, wait, condition, tag, pipeline,
//        task, resource, social_post, webhook, notify
// ═══════════════════════════════════════════════════════════════

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Mail, MessageCircle, Clock, GitBranch, Tag, ArrowRight,
  CheckSquare, FileText, Globe, Bell, Plus, X, Trash2, Save,
  Play, Pause, Zap, MousePointer, ZoomIn, ZoomOut, Undo2,
  Send, Users, ChevronDown, GripVertical, Share2,
  Smartphone, Instagram, Facebook, Linkedin, Youtube
} from 'lucide-react'

// ─── Types ───

export interface FlowNode {
  id: string
  type: NodeType
  x: number
  y: number
  data: Record<string, any>
  label: string
}

export interface FlowEdge {
  id: string
  from: string
  to: string
  fromHandle: 'default' | 'yes' | 'no'
  label?: string
}

type NodeType =
  | 'trigger' | 'send_email' | 'send_sms' | 'wait'
  | 'condition' | 'add_tag' | 'remove_tag' | 'move_pipeline'
  | 'create_task' | 'send_resource' | 'social_post'
  | 'webhook' | 'notify'

// ─── Node Config ───

const NODE_DEFS: Record<NodeType, {
  label: string; icon: any; color: string; bg: string; category: string; desc: string
}> = {
  trigger:        { label: 'Trigger',        icon: Zap,            color: '#f59e0b', bg: '#fef3c7', category: 'entry',   desc: 'Entry point for contacts' },
  send_email:     { label: 'Send Email',     icon: Mail,           color: '#3b82f6', bg: '#dbeafe', category: 'action',  desc: 'Send an email to contact' },
  send_sms:       { label: 'Send SMS',       icon: MessageCircle,  color: '#10b981', bg: '#d1fae5', category: 'action',  desc: 'Send a text message' },
  wait:           { label: 'Wait / Delay',   icon: Clock,          color: '#8b5cf6', bg: '#ede9fe', category: 'flow',    desc: 'Pause before next step' },
  condition:      { label: 'If / Else',      icon: GitBranch,      color: '#f97316', bg: '#ffedd5', category: 'flow',    desc: 'Branch based on condition' },
  add_tag:        { label: 'Add Tag',        icon: Tag,            color: '#06b6d4', bg: '#cffafe', category: 'action',  desc: 'Tag the contact' },
  remove_tag:     { label: 'Remove Tag',     icon: Tag,            color: '#64748b', bg: '#f1f5f9', category: 'action',  desc: 'Remove a tag' },
  move_pipeline:  { label: 'Move Stage',     icon: ArrowRight,     color: '#386797', bg: '#dbeafe', category: 'action',  desc: 'Change pipeline stage' },
  create_task:    { label: 'Create Task',    icon: CheckSquare,    color: '#d946ef', bg: '#fae8ff', category: 'action',  desc: 'Auto-create a task' },
  send_resource:  { label: 'Send Resource',  icon: FileText,       color: '#0ea5e9', bg: '#e0f2fe', category: 'action',  desc: 'Email a resource/file' },
  social_post:    { label: 'Social Post',    icon: Share2,         color: '#ec4899', bg: '#fce7f3', category: 'social',  desc: 'Schedule a social post' },
  webhook:        { label: 'Webhook',        icon: Globe,          color: '#475569', bg: '#f1f5f9', category: 'advanced',desc: 'Call an external URL' },
  notify:         { label: 'Notify Team',    icon: Bell,           color: '#eab308', bg: '#fef9c3', category: 'action',  desc: 'Internal notification' },
}

const TRIGGER_OPTIONS = [
  { id: 'new_contact',       label: 'New Contact Added' },
  { id: 'form_submit',       label: 'Form Submitted' },
  { id: 'tag_added',         label: 'Tag Added' },
  { id: 'pipeline_change',   label: 'Pipeline Stage Changed' },
  { id: 'manual',            label: 'Manual Enrollment' },
  { id: 'date_trigger',      label: 'Date/Schedule Based' },
]

const CONDITION_OPTIONS = [
  { id: 'email_opened',    label: 'Opened Previous Email' },
  { id: 'email_clicked',   label: 'Clicked Link in Email' },
  { id: 'has_tag',          label: 'Contact Has Tag' },
  { id: 'pipeline_stage',  label: 'Pipeline Stage Is' },
  { id: 'custom_field',    label: 'Custom Field Matches' },
  { id: 'time_elapsed',    label: 'Time Since Last Action' },
]

const WAIT_UNITS = [
  { id: 'minutes', label: 'Minutes' },
  { id: 'hours',   label: 'Hours' },
  { id: 'days',    label: 'Days' },
  { id: 'weeks',   label: 'Weeks' },
]

const SOCIAL_PLATFORMS = [
  { id: 'instagram', label: 'Instagram', icon: Instagram },
  { id: 'facebook',  label: 'Facebook',  icon: Facebook },
  { id: 'linkedin',  label: 'LinkedIn',  icon: Linkedin },
  { id: 'youtube',   label: 'YouTube',   icon: Youtube },
  { id: 'tiktok',    label: 'TikTok',    icon: Smartphone },
]

const PALETTE_CATEGORIES = [
  { id: 'entry',    label: 'Entry Points' },
  { id: 'action',   label: 'Actions' },
  { id: 'flow',     label: 'Flow Control' },
  { id: 'social',   label: 'Social Media' },
  { id: 'advanced', label: 'Advanced' },
]

const PIPELINE_STAGES = [
  'New Lead', 'Contacted', 'Qualified', 'Discovery', 'Proposal', 'Enrolled', 'Active', 'Graduated'
]

// ─── Helpers ───

function bezierPath(x1: number, y1: number, x2: number, y2: number) {
  const midY = (y1 + y2) / 2
  const cp = Math.min(Math.abs(y2 - y1) * 0.5, 80)
  return `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`
}

function makeId() { return `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }

// ─── Component ───

interface FlowBuilderProps {
  nodes: FlowNode[]
  edges: FlowEdge[]
  onChange: (nodes: FlowNode[], edges: FlowEdge[]) => void
  teamMembers?: Array<{ id: string; display_name: string }>
  readOnly?: boolean
}

export default function CampaignFlowBuilder({ nodes, edges, onChange, teamMembers = [], readOnly = false }: FlowBuilderProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [dragging, setDragging] = useState<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const [connecting, setConnecting] = useState<{ fromId: string; handle: 'default' | 'yes' | 'no'; mx: number; my: number } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [showPalette, setShowPalette] = useState(true)

  const NODE_W = 220
  const NODE_H = 72
  const HANDLE_SIZE = 10

  // ─── Node CRUD ───

  const addNode = useCallback((type: NodeType, x?: number, y?: number) => {
    const def = NODE_DEFS[type]
    const newNode: FlowNode = {
      id: makeId(), type,
      x: x ?? 300 + Math.random() * 100,
      y: y ?? 100 + nodes.length * 120,
      data: type === 'wait' ? { amount: 1, unit: 'days' }
        : type === 'trigger' ? { trigger_type: 'new_contact' }
        : type === 'condition' ? { condition_type: 'email_opened', value: '' }
        : type === 'send_email' ? { subject: '', body: '', from_email: 'Cameron.allen@neuroprogeny.com' }
        : type === 'send_sms' ? { message: '', from_label: 'Neuro Progeny' }
        : type === 'social_post' ? { platform: 'instagram', content: '', scheduled_at: '' }
        : type === 'move_pipeline' ? { stage: 'Contacted' }
        : type === 'add_tag' ? { tag: '' }
        : type === 'remove_tag' ? { tag: '' }
        : type === 'create_task' ? { title: '', assignee: '', priority: 'medium' }
        : type === 'send_resource' ? { resource_name: '', resource_url: '', from_email: 'Cameron.allen@neuroprogeny.com' }
        : type === 'webhook' ? { url: '', method: 'POST' }
        : type === 'notify' ? { message: '', notify_to: '' }
        : {},
      label: def.label,
    }
    onChange([...nodes, newNode], edges)
    setSelectedNode(newNode.id)
  }, [nodes, edges, onChange])

  const updateNodeData = useCallback((id: string, data: Record<string, any>) => {
    onChange(nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n), edges)
  }, [nodes, edges, onChange])

  const updateNodeLabel = useCallback((id: string, label: string) => {
    onChange(nodes.map(n => n.id === id ? { ...n, label } : n), edges)
  }, [nodes, edges, onChange])

  const deleteNode = useCallback((id: string) => {
    onChange(nodes.filter(n => n.id !== id), edges.filter(e => e.from !== id && e.to !== id))
    if (selectedNode === id) setSelectedNode(null)
  }, [nodes, edges, selectedNode, onChange])

  const addEdge = useCallback((from: string, to: string, handle: 'default' | 'yes' | 'no' = 'default') => {
    if (from === to) return
    if (edges.some(e => e.from === from && e.to === to && e.fromHandle === handle)) return
    const label = handle === 'yes' ? 'Yes' : handle === 'no' ? 'No' : undefined
    onChange(nodes, [...edges, { id: `e-${Date.now()}`, from, to, fromHandle: handle, label }])
  }, [nodes, edges, onChange])

  const deleteEdge = useCallback((id: string) => {
    onChange(nodes, edges.filter(e => e.id !== id))
  }, [nodes, edges, onChange])

  // ─── Canvas Events ───

  const handleCanvasMouseMove = useCallback((e: React.MouseEvent) => {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left - pan.x) / zoom
    const my = (e.clientY - rect.top - pan.y) / zoom

    if (dragging) {
      onChange(nodes.map(n => n.id === dragging.id ? { ...n, x: mx - dragging.offsetX, y: my - dragging.offsetY } : n), edges)
    }
    if (connecting) {
      setConnecting(prev => prev ? { ...prev, mx, my } : null)
    }
  }, [dragging, connecting, nodes, edges, zoom, pan, onChange])

  const handleCanvasMouseUp = useCallback((e: React.MouseEvent) => {
    if (connecting && canvasRef.current) {
      const rect = canvasRef.current.getBoundingClientRect()
      const mx = (e.clientX - rect.left - pan.x) / zoom
      const my = (e.clientY - rect.top - pan.y) / zoom
      const target = nodes.find(n => mx >= n.x && mx <= n.x + NODE_W && my >= n.y && my <= n.y + NODE_H && n.id !== connecting.fromId)
      if (target) addEdge(connecting.fromId, target.id, connecting.handle)
    }
    setDragging(null)
    setConnecting(null)
  }, [connecting, nodes, zoom, pan, addEdge])

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, node: FlowNode) => {
    if (readOnly) return
    e.stopPropagation()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = (e.clientX - rect.left - pan.x) / zoom
    const my = (e.clientY - rect.top - pan.y) / zoom
    setDragging({ id: node.id, offsetX: mx - node.x, offsetY: my - node.y })
    setSelectedNode(node.id)
  }, [readOnly, zoom, pan])

  const handleHandleMouseDown = useCallback((e: React.MouseEvent, nodeId: string, handle: 'default' | 'yes' | 'no') => {
    if (readOnly) return
    e.stopPropagation()
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    setConnecting({
      fromId: nodeId, handle,
      mx: (e.clientX - rect.left - pan.x) / zoom,
      my: (e.clientY - rect.top - pan.y) / zoom,
    })
  }, [readOnly, zoom, pan])

  // ─── Render Helpers ───

  const getHandlePos = (node: FlowNode, handle: 'top' | 'default' | 'yes' | 'no') => {
    if (handle === 'top') return { x: node.x + NODE_W / 2, y: node.y }
    if (handle === 'yes') return { x: node.x + NODE_W * 0.3, y: node.y + NODE_H }
    if (handle === 'no') return { x: node.x + NODE_W * 0.7, y: node.y + NODE_H }
    return { x: node.x + NODE_W / 2, y: node.y + NODE_H }
  }

  const selectedNodeObj = nodes.find(n => n.id === selectedNode)

  // ─── Render ───

  return (
    <div className="flex h-full bg-gray-50 rounded-xl overflow-hidden border border-gray-200">

      {/* ── Left: Node Palette ── */}
      {showPalette && !readOnly && (
        <div className="w-52 bg-white border-r border-gray-200 flex flex-col overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Node Palette</span>
            <button onClick={() => setShowPalette(false)} className="p-0.5 hover:bg-gray-50 rounded"><X size={10} className="text-gray-400" /></button>
          </div>
          {PALETTE_CATEGORIES.map(cat => {
            const catNodes = Object.entries(NODE_DEFS).filter(([, d]) => d.category === cat.id)
            if (catNodes.length === 0) return null
            return (
              <div key={cat.id} className="px-2 py-2 border-b border-gray-50">
                <p className="text-[8px] font-bold uppercase text-gray-300 tracking-wider mb-1.5 px-1">{cat.label}</p>
                <div className="space-y-1">
                  {catNodes.map(([type, def]) => {
                    const Icon = def.icon
                    return (
                      <button key={type} onClick={() => addNode(type as NodeType)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 transition-colors text-left group">
                        <div className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0"
                          style={{ background: def.bg }}>
                          <Icon size={12} style={{ color: def.color }} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-medium text-np-dark truncate">{def.label}</p>
                          <p className="text-[8px] text-gray-400 truncate">{def.desc}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── Center: Canvas ── */}
      <div className="flex-1 relative overflow-hidden">
        {/* Toolbar */}
        <div className="absolute top-3 left-3 z-20 flex gap-1 bg-white/90 backdrop-blur-sm rounded-lg border border-gray-200 shadow-sm p-1">
          {!showPalette && !readOnly && (
            <button onClick={() => setShowPalette(true)} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Show palette">
              <Plus size={13} className="text-gray-500" />
            </button>
          )}
          <button onClick={() => setZoom(z => Math.min(z + 0.1, 2))} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Zoom in">
            <ZoomIn size={13} className="text-gray-500" />
          </button>
          <button onClick={() => setZoom(z => Math.max(z - 0.1, 0.4))} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Zoom out">
            <ZoomOut size={13} className="text-gray-500" />
          </button>
          <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="p-1.5 rounded hover:bg-gray-100 transition-colors" title="Reset view">
            <MousePointer size={13} className="text-gray-500" />
          </button>
          <div className="w-px h-5 bg-gray-200 mx-0.5 self-center" />
          <span className="text-[9px] text-gray-400 self-center px-1">{Math.round(zoom * 100)}%</span>
        </div>

        {/* Canvas Stats */}
        <div className="absolute top-3 right-3 z-20 flex gap-2 text-[9px] text-gray-400">
          <span className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded border border-gray-200">{nodes.length} nodes</span>
          <span className="bg-white/90 backdrop-blur-sm px-2 py-1 rounded border border-gray-200">{edges.length} connections</span>
        </div>

        {/* Drop hint */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <div className="text-center">
              <Zap size={32} className="mx-auto text-gray-300 mb-2" />
              <p className="text-sm text-gray-400 font-medium">Start by adding a Trigger node</p>
              <p className="text-[10px] text-gray-300 mt-1">Click a node type from the palette to begin</p>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div ref={canvasRef} className="w-full h-full cursor-grab active:cursor-grabbing"
          style={{ background: 'radial-gradient(circle, #e5e7eb 1px, transparent 1px)', backgroundSize: `${20 * zoom}px ${20 * zoom}px` }}
          onClick={() => setSelectedNode(null)}
          onMouseMove={handleCanvasMouseMove}
          onMouseUp={handleCanvasMouseUp}
          onMouseLeave={() => { setDragging(null); setConnecting(null) }}>

          <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}
            className="absolute inset-0">

            {/* SVG Edges */}
            <svg className="absolute inset-0 pointer-events-none" style={{ width: 3000, height: 3000, overflow: 'visible' }}>
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#94a3b8" />
                </marker>
                <marker id="arrowhead-active" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0, 8 3, 0 6" fill="#386797" />
                </marker>
              </defs>
              {edges.map(edge => {
                const fromNode = nodes.find(n => n.id === edge.from)
                const toNode = nodes.find(n => n.id === edge.to)
                if (!fromNode || !toNode) return null
                const fromPos = getHandlePos(fromNode, edge.fromHandle)
                const toPos = getHandlePos(toNode, 'top')
                const isSelected = selectedNode === edge.from || selectedNode === edge.to
                return (
                  <g key={edge.id}>
                    <path d={bezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
                      fill="none" stroke={isSelected ? '#386797' : '#cbd5e1'} strokeWidth={isSelected ? 2.5 : 2}
                      markerEnd={isSelected ? 'url(#arrowhead-active)' : 'url(#arrowhead)'}
                      className="transition-colors" />
                    {edge.label && (
                      <text x={(fromPos.x + toPos.x) / 2 + (edge.fromHandle === 'yes' ? -20 : edge.fromHandle === 'no' ? 20 : 0)}
                        y={(fromPos.y + toPos.y) / 2}
                        textAnchor="middle" className="text-[9px] font-bold" fill={edge.label === 'Yes' ? '#10b981' : '#ef4444'}>
                        {edge.label}
                      </text>
                    )}
                    {/* Clickable hit area for edge deletion */}
                    {!readOnly && (
                      <path d={bezierPath(fromPos.x, fromPos.y, toPos.x, toPos.y)}
                        fill="none" stroke="transparent" strokeWidth={12} className="cursor-pointer pointer-events-auto"
                        onClick={(e) => { e.stopPropagation(); if (confirm('Delete this connection?')) deleteEdge(edge.id) }} />
                    )}
                  </g>
                )
              })}
              {/* Temp connection line while dragging */}
              {connecting && (() => {
                const fromNode = nodes.find(n => n.id === connecting.fromId)
                if (!fromNode) return null
                const fromPos = getHandlePos(fromNode, connecting.handle)
                return <path d={bezierPath(fromPos.x, fromPos.y, connecting.mx, connecting.my)}
                  fill="none" stroke="#386797" strokeWidth={2} strokeDasharray="6 3" />
              })()}
            </svg>

            {/* Nodes */}
            {nodes.map(node => {
              const def = NODE_DEFS[node.type]
              const Icon = def.icon
              const isSelected = selectedNode === node.id
              const isCondition = node.type === 'condition'

              return (
                <div key={node.id}
                  style={{ left: node.x, top: node.y, width: NODE_W }}
                  className={`absolute select-none transition-shadow ${
                    isSelected ? 'ring-2 ring-[#386797] shadow-lg' : 'shadow-sm hover:shadow-md'
                  } bg-white rounded-xl border ${isSelected ? 'border-[#386797]/40' : 'border-gray-200'} overflow-hidden`}
                  onMouseDown={(e) => handleNodeMouseDown(e, node)}
                  onClick={(e) => { e.stopPropagation(); setSelectedNode(node.id) }}>

                  {/* Header */}
                  <div className="flex items-center gap-2 px-3 py-2 border-b" style={{ borderColor: def.color + '30', background: def.bg + '60' }}>
                    {!readOnly && <GripVertical size={10} className="text-gray-400 cursor-grab flex-shrink-0" />}
                    <div className="w-5 h-5 rounded flex items-center justify-center" style={{ background: def.bg }}>
                      <Icon size={11} style={{ color: def.color }} />
                    </div>
                    <span className="text-[10px] font-bold text-np-dark truncate flex-1">{node.label}</span>
                    {!readOnly && (
                      <button onClick={(e) => { e.stopPropagation(); deleteNode(node.id) }}
                        className="p-0.5 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity">
                        <X size={9} className="text-gray-400 hover:text-red-500" />
                      </button>
                    )}
                  </div>

                  {/* Body preview */}
                  <div className="px-3 py-1.5 min-h-[28px]">
                    {node.type === 'trigger' && (
                      <p className="text-[9px] text-gray-500">{TRIGGER_OPTIONS.find(t => t.id === node.data.trigger_type)?.label || 'Configure trigger'}</p>
                    )}
                    {node.type === 'send_email' && (
                      <p className="text-[9px] text-gray-500 truncate">{node.data.subject || 'No subject set'}</p>
                    )}
                    {node.type === 'send_sms' && (
                      <p className="text-[9px] text-gray-500 truncate">{node.data.message || 'No message set'}</p>
                    )}
                    {node.type === 'wait' && (
                      <p className="text-[9px] text-gray-500">Wait {node.data.amount} {node.data.unit}</p>
                    )}
                    {node.type === 'condition' && (
                      <p className="text-[9px] text-gray-500">{CONDITION_OPTIONS.find(c => c.id === node.data.condition_type)?.label || 'Set condition'}</p>
                    )}
                    {node.type === 'social_post' && (
                      <p className="text-[9px] text-gray-500 truncate">{node.data.platform} &mdash; {node.data.content || 'No content'}</p>
                    )}
                    {node.type === 'add_tag' && <p className="text-[9px] text-gray-500">{node.data.tag || 'Set tag name'}</p>}
                    {node.type === 'remove_tag' && <p className="text-[9px] text-gray-500">{node.data.tag || 'Set tag name'}</p>}
                    {node.type === 'move_pipeline' && <p className="text-[9px] text-gray-500">To: {node.data.stage || 'Select stage'}</p>}
                    {node.type === 'create_task' && <p className="text-[9px] text-gray-500 truncate">{node.data.title || 'Configure task'}</p>}
                    {node.type === 'send_resource' && <p className="text-[9px] text-gray-500 truncate">{node.data.resource_name || 'Select resource'}</p>}
                    {node.type === 'webhook' && <p className="text-[9px] text-gray-500 truncate">{node.data.method} {node.data.url || 'Set URL'}</p>}
                    {node.type === 'notify' && <p className="text-[9px] text-gray-500 truncate">{node.data.message || 'Set message'}</p>}
                  </div>

                  {/* Input handle (top center) */}
                  {node.type !== 'trigger' && (
                    <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-300 hover:border-[#386797] transition-colors cursor-crosshair z-10" />
                  )}

                  {/* Output handle(s) */}
                  {isCondition ? (
                    <>
                      <div className="absolute -bottom-1.5 left-[30%] -translate-x-1/2 flex flex-col items-center z-10"
                        onMouseDown={(e) => handleHandleMouseDown(e, node.id, 'yes')}>
                        <div className="w-3 h-3 rounded-full bg-green-500 border-2 border-white cursor-crosshair hover:scale-125 transition-transform" />
                        <span className="text-[7px] font-bold text-green-600 mt-0.5">YES</span>
                      </div>
                      <div className="absolute -bottom-1.5 right-[30%] translate-x-1/2 flex flex-col items-center z-10"
                        onMouseDown={(e) => handleHandleMouseDown(e, node.id, 'no')}>
                        <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-white cursor-crosshair hover:scale-125 transition-transform" />
                        <span className="text-[7px] font-bold text-red-500 mt-0.5">NO</span>
                      </div>
                    </>
                  ) : (
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-[#386797] border-2 border-white cursor-crosshair hover:scale-125 transition-transform z-10"
                      onMouseDown={(e) => handleHandleMouseDown(e, node.id, 'default')} />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Right: Property Editor ── */}
      {selectedNodeObj && (
        <div className="w-72 bg-white border-l border-gray-200 flex flex-col overflow-y-auto flex-shrink-0">
          <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {(() => { const Icon = NODE_DEFS[selectedNodeObj.type].icon; return <Icon size={12} style={{ color: NODE_DEFS[selectedNodeObj.type].color }} /> })()}
              <span className="text-[10px] font-bold text-np-dark">{NODE_DEFS[selectedNodeObj.type].label}</span>
            </div>
            <button onClick={() => setSelectedNode(null)} className="p-0.5 hover:bg-gray-50 rounded"><X size={10} className="text-gray-400" /></button>
          </div>

          <div className="p-3 space-y-3">
            {/* Node Label */}
            <div>
              <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Label</label>
              <input value={selectedNodeObj.label} onChange={e => updateNodeLabel(selectedNodeObj.id, e.target.value)}
                disabled={readOnly}
                className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-[#386797]/30" />
            </div>

            {/* ─ Type-specific editors ─ */}

            {selectedNodeObj.type === 'trigger' && (
              <div>
                <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Trigger Type</label>
                <select value={selectedNodeObj.data.trigger_type || ''} disabled={readOnly}
                  onChange={e => updateNodeData(selectedNodeObj.id, { trigger_type: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-white">
                  {TRIGGER_OPTIONS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                {selectedNodeObj.data.trigger_type === 'tag_added' && (
                  <input placeholder="Tag name..." className="w-full mt-1.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md"
                    value={selectedNodeObj.data.tag || ''} onChange={e => updateNodeData(selectedNodeObj.id, { tag: e.target.value })} />
                )}
                {selectedNodeObj.data.trigger_type === 'pipeline_change' && (
                  <select className="w-full mt-1.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md"
                    value={selectedNodeObj.data.stage || ''} onChange={e => updateNodeData(selectedNodeObj.id, { stage: e.target.value })}>
                    <option value="">Any stage</option>
                    {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                )}
              </div>
            )}

            {selectedNodeObj.type === 'send_email' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">From</label>
                  <input value={selectedNodeObj.data.from_email || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { from_email: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-gray-50 text-gray-600" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Subject</label>
                  <input value={selectedNodeObj.data.subject || ''} disabled={readOnly} placeholder="Your nervous system is ready..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { subject: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Body</label>
                  <textarea value={selectedNodeObj.data.body || ''} disabled={readOnly} rows={4}
                    placeholder="Hi {{first_name}},&#10;&#10;..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { body: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md font-mono resize-none" />
                  <p className="text-[8px] text-gray-400 mt-0.5">Merge tags: {'{{first_name}}'}, {'{{last_name}}'}, {'{{email}}'}</p>
                </div>
              </>
            )}

            {selectedNodeObj.type === 'send_sms' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Message</label>
                  <textarea value={selectedNodeObj.data.message || ''} disabled={readOnly} rows={3}
                    placeholder="Hi {{first_name}}, ..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { message: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md resize-none" />
                  <p className="text-[8px] text-gray-400 mt-0.5">{(selectedNodeObj.data.message || '').length}/160 characters ({Math.ceil((selectedNodeObj.data.message || '').length / 160) || 0} segments)</p>
                </div>
              </>
            )}

            {selectedNodeObj.type === 'wait' && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Amount</label>
                  <input type="number" min={1} value={selectedNodeObj.data.amount || 1} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { amount: parseInt(e.target.value) || 1 })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
                <div className="flex-1">
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Unit</label>
                  <select value={selectedNodeObj.data.unit || 'days'} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { unit: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    {WAIT_UNITS.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                  </select>
                </div>
              </div>
            )}

            {selectedNodeObj.type === 'condition' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Condition</label>
                  <select value={selectedNodeObj.data.condition_type || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { condition_type: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    {CONDITION_OPTIONS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </div>
                {['has_tag', 'pipeline_stage', 'custom_field'].includes(selectedNodeObj.data.condition_type) && (
                  <div>
                    <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Value</label>
                    {selectedNodeObj.data.condition_type === 'pipeline_stage' ? (
                      <select value={selectedNodeObj.data.value || ''} disabled={readOnly}
                        onChange={e => updateNodeData(selectedNodeObj.id, { value: e.target.value })}
                        className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                        <option value="">Select stage...</option>
                        {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    ) : (
                      <input value={selectedNodeObj.data.value || ''} disabled={readOnly} placeholder="Enter value..."
                        onChange={e => updateNodeData(selectedNodeObj.id, { value: e.target.value })}
                        className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 pt-1">
                  <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-green-500" /><span className="text-[8px] text-gray-500">Yes branch</span></div>
                  <div className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded-full bg-red-500" /><span className="text-[8px] text-gray-500">No branch</span></div>
                </div>
              </>
            )}

            {selectedNodeObj.type === 'social_post' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Platform</label>
                  <div className="flex gap-1 mt-0.5">
                    {SOCIAL_PLATFORMS.map(p => {
                      const PIcon = p.icon
                      return (
                        <button key={p.id} disabled={readOnly}
                          onClick={() => updateNodeData(selectedNodeObj.id, { platform: p.id })}
                          className={`flex-1 flex flex-col items-center gap-0.5 py-1.5 rounded-md border text-[8px] transition-all ${
                            selectedNodeObj.data.platform === p.id ? 'border-[#386797] bg-[#386797]/5 text-[#386797] font-medium' : 'border-gray-200 text-gray-400'
                          }`}>
                          <PIcon size={12} />{p.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Content</label>
                  <textarea value={selectedNodeObj.data.content || ''} disabled={readOnly} rows={3} placeholder="Post content..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { content: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md resize-none" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Schedule</label>
                  <input type="datetime-local" value={selectedNodeObj.data.scheduled_at || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { scheduled_at: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
              </>
            )}

            {(selectedNodeObj.type === 'add_tag' || selectedNodeObj.type === 'remove_tag') && (
              <div>
                <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Tag Name</label>
                <input value={selectedNodeObj.data.tag || ''} disabled={readOnly} placeholder="e.g., mastermind-interested"
                  onChange={e => updateNodeData(selectedNodeObj.id, { tag: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
              </div>
            )}

            {selectedNodeObj.type === 'move_pipeline' && (
              <div>
                <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Move To Stage</label>
                <select value={selectedNodeObj.data.stage || ''} disabled={readOnly}
                  onChange={e => updateNodeData(selectedNodeObj.id, { stage: e.target.value })}
                  className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                  {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {selectedNodeObj.type === 'create_task' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Task Title</label>
                  <input value={selectedNodeObj.data.title || ''} disabled={readOnly} placeholder="Follow up with {{first_name}}"
                    onChange={e => updateNodeData(selectedNodeObj.id, { title: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Assign To</label>
                  <select value={selectedNodeObj.data.assignee || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { assignee: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    <option value="">Unassigned</option>
                    {teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Priority</label>
                  <select value={selectedNodeObj.data.priority || 'medium'} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { priority: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    <option value="low">Low</option><option value="medium">Medium</option>
                    <option value="high">High</option><option value="critical">Critical</option>
                  </select>
                </div>
              </>
            )}

            {selectedNodeObj.type === 'send_resource' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Resource Name</label>
                  <input value={selectedNodeObj.data.resource_name || ''} disabled={readOnly} placeholder="Welcome Packet"
                    onChange={e => updateNodeData(selectedNodeObj.id, { resource_name: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Resource URL</label>
                  <input value={selectedNodeObj.data.resource_url || ''} disabled={readOnly} placeholder="https://..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { resource_url: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">From Email</label>
                  <input value={selectedNodeObj.data.from_email || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { from_email: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md bg-gray-50" />
                </div>
              </>
            )}

            {selectedNodeObj.type === 'webhook' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Method</label>
                  <select value={selectedNodeObj.data.method || 'POST'} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { method: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    <option>POST</option><option>GET</option><option>PUT</option>
                  </select>
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">URL</label>
                  <input value={selectedNodeObj.data.url || ''} disabled={readOnly} placeholder="https://api.example.com/webhook"
                    onChange={e => updateNodeData(selectedNodeObj.id, { url: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md font-mono" />
                </div>
              </>
            )}

            {selectedNodeObj.type === 'notify' && (
              <>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Message</label>
                  <textarea value={selectedNodeObj.data.message || ''} disabled={readOnly} rows={2}
                    placeholder="Contact {{first_name}} just..."
                    onChange={e => updateNodeData(selectedNodeObj.id, { message: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md resize-none" />
                </div>
                <div>
                  <label className="text-[8px] font-semibold uppercase text-gray-400 tracking-wider">Notify</label>
                  <select value={selectedNodeObj.data.notify_to || ''} disabled={readOnly}
                    onChange={e => updateNodeData(selectedNodeObj.id, { notify_to: e.target.value })}
                    className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-md">
                    <option value="">All admins</option>
                    {teamMembers.map(m => <option key={m.id} value={m.id}>{m.display_name}</option>)}
                  </select>
                </div>
              </>
            )}

            {/* Delete Node */}
            {!readOnly && (
              <button onClick={() => deleteNode(selectedNodeObj.id)}
                className="w-full flex items-center justify-center gap-1 px-3 py-1.5 text-[10px] font-medium text-red-500 bg-red-50 rounded-md hover:bg-red-100 transition-colors mt-2">
                <Trash2 size={10} /> Delete Node
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
