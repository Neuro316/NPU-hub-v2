'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Plus, X, Trash2, Copy, Tag, Pencil, ZoomIn, ZoomOut, RotateCcw,
  PanelLeftClose, PanelLeftOpen, GitBranch, ChevronDown, Loader2
} from 'lucide-react'

// ============================================
// TYPES
// ============================================
interface FlowNode {
  id: string; type: string; x: number; y: number; w: number; h: number
  text: string; tags: TagItem[]
}
interface FlowConn {
  id: string; from: string; to: string; fromSide: string; toSide: string; label: string
}
interface TagItem { label: string; color: string }
interface FlowChart {
  id: string; name: string; nodes: FlowNode[]; connections: FlowConn[]
  custom_tags: TagItem[]; updated_at?: string
}

// ============================================
// CONSTANTS
// ============================================
const NODE_TYPES: Record<string, { label: string; color: string; minW: number; minH: number }> = {
  process: { label: 'Process', color: '#3B82F6', minW: 120, minH: 52 },
  decision: { label: 'Decision', color: '#F59E0B', minW: 120, minH: 80 },
  start: { label: 'Start / End', color: '#10B981', minW: 110, minH: 48 },
  data: { label: 'Data / Input', color: '#8B5CF6', minW: 120, minH: 52 },
  email: { label: 'Email / Action', color: '#EF4444', minW: 120, minH: 52 },
  note: { label: 'Note', color: '#6B7280', minW: 120, minH: 52 },
}

const C = {
  bg: '#0F1117', surface: '#1A1D27', surfaceHover: '#242836',
  border: '#2E3344', text: '#E2E8F0', textMuted: '#8892A8',
  grid: '#1E2130', accent: '#3B82F6',
}

const TAG_PRESETS: TagItem[] = [
  { label: 'To Do', color: '#6B7280' }, { label: 'In Progress', color: '#F59E0B' },
  { label: 'Done', color: '#10B981' }, { label: 'Blocked', color: '#EF4444' },
  { label: 'Review', color: '#8B5CF6' }, { label: 'Priority', color: '#EC4899' },
  { label: 'API', color: '#06B6D4' }, { label: 'Email', color: '#F97316' },
]
const TAG_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316','#6B7280','#14B8A6','#A855F7','#E11D48']

const genId = () => Math.random().toString(36).slice(2, 10)

// ============================================
// GEOMETRY HELPERS
// ============================================
const getPort = (node: FlowNode, side: string) => {
  const cx = node.x + node.w / 2, cy = node.y + node.h / 2
  if (side === 'top') return { x: cx, y: node.y }
  if (side === 'bottom') return { x: cx, y: node.y + node.h }
  if (side === 'left') return { x: node.x, y: cy }
  if (side === 'right') return { x: node.x + node.w, y: cy }
  return { x: cx, y: cy }
}

const SD: Record<string, number[]> = { top: [0,-1], bottom: [0,1], left: [-1,0], right: [1,0] }

const makePath = (x1: number, y1: number, x2: number, y2: number, fs: string, ts: string) => {
  const dist = Math.hypot(x2-x1, y2-y1), curve = Math.min(dist*0.4, 80)
  const fd = SD[fs]||[0,1], td = SD[ts]||[0,-1]
  return `M ${x1} ${y1} C ${x1+fd[0]*curve} ${y1+fd[1]*curve}, ${x2+td[0]*curve} ${y2+td[1]*curve}, ${x2} ${y2}`
}

const distToBezier = (px: number, py: number, x1: number, y1: number, x2: number, y2: number, fs: string, ts: string) => {
  const dist = Math.hypot(x2-x1, y2-y1), curve = Math.min(dist*0.4, 80)
  const fd = SD[fs]||[0,1], td = SD[ts]||[0,-1]
  const cx1=x1+fd[0]*curve, cy1=y1+fd[1]*curve, cx2=x2+td[0]*curve, cy2=y2+td[1]*curve
  let minD = Infinity
  for (let t=0; t<=1; t+=0.05) {
    const it=1-t
    const bx=it*it*it*x1+3*it*it*t*cx1+3*it*t*t*cx2+t*t*t*x2
    const by=it*it*it*y1+3*it*it*t*cy1+3*it*t*t*cy2+t*t*t*y2
    const d=Math.hypot(px-bx,py-by)
    if(d<minD) minD=d
  }
  return minD
}

const closestPortSide = (node: FlowNode, px: number, py: number) => {
  let best='top', minD=Infinity
  for (const s of ['top','bottom','left','right']) {
    const p = getPort(node, s), d = Math.hypot(px-p.x, py-p.y)
    if (d < minD) { minD = d; best = s }
  }
  return best
}

// ============================================
// TEXT MEASUREMENT
// ============================================
let _mc: CanvasRenderingContext2D | null = null
const getMC = () => { if (!_mc) _mc = document.createElement('canvas').getContext('2d'); return _mc! }

const calcNodeSize = (text: string, type: string, tags?: TagItem[]) => {
  const cfg = NODE_TYPES[type], mc = getMC()
  mc.font = "500 13px 'Inter', sans-serif"
  const padX = type==='decision'?80:type==='start'?40:32
  const padY = type==='decision'?60:type==='start'?24:24
  const maxW = type==='decision'?280:type==='note'?260:240
  const lineH = 18, tagRowH = (tags && tags.length > 0) ? 20 : 0
  const contentMaxW = maxW - padX
  const words = text.split(/(\s+)/).filter(Boolean)
  const lines: string[] = []
  let curLine = ''
  for (const word of words) {
    if (/^\s+$/.test(word)) { curLine += ' '; continue }
    const test = curLine + word
    if (mc.measureText(test).width <= contentMaxW || !curLine.trim()) {
      if (mc.measureText(test).width > contentMaxW && !curLine.trim()) {
        let chunk = ''
        for (const ch of word) {
          if (mc.measureText(chunk+ch).width > contentMaxW && chunk) { lines.push(chunk); chunk = ch }
          else chunk += ch
        }
        curLine = chunk
      } else curLine = test
    } else {
      lines.push(curLine.trim())
      if (mc.measureText(word).width > contentMaxW) {
        let chunk = ''
        for (const ch of word) {
          if (mc.measureText(chunk+ch).width > contentMaxW && chunk) { lines.push(chunk); chunk = ch }
          else chunk += ch
        }
        curLine = chunk
      } else curLine = word
    }
  }
  if (curLine.trim()) lines.push(curLine.trim())
  if (!lines.length) lines.push('')
  const widest = Math.max(...lines.map(l => mc.measureText(l).width))
  const w = Math.max(cfg.minW, Math.min(maxW, Math.ceil(widest + padX)))
  const h = Math.max(cfg.minH, Math.ceil(lines.length * lineH + padY + tagRowH))
  return { w, h }
}

// ============================================
// MAIN COMPONENT
// ============================================
export default function FlowchartsPage() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()
  const orgId = currentOrg?.id

  // Chart list
  const [charts, setCharts] = useState<FlowChart[]>([])
  const [activeChartId, setActiveChartId] = useState<string | null>(null)
  // Active chart state
  const [nodes, setNodes] = useState<FlowNode[]>([])
  const [connections, setConnections] = useState<FlowConn[]>([])
  const [chartName, setChartName] = useState('Untitled Flowchart')
  const [customTags, setCustomTags] = useState<TagItem[]>([])
  // Selection / editing
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedConn, setSelectedConn] = useState<string | null>(null)
  const [connectingFrom, setConnectingFrom] = useState<{ nodeId: string; side: string; port: { x: number; y: number } } | null>(null)
  const [tempLineEnd, setTempLineEnd] = useState<{ x: number; y: number } | null>(null)
  const [editingNode, setEditingNode] = useState<string | null>(null)
  const [editingConn, setEditingConn] = useState<string | null>(null)
  // Canvas
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [draggingNode, setDraggingNode] = useState<string | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null)
  // UI
  const [showSidebar, setShowSidebar] = useState(true)
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [newTagLabel, setNewTagLabel] = useState('')
  const [newTagColor, setNewTagColor] = useState('#06B6D4')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragOffset = useRef({ x: 0, y: 0 })
  const nodesRef = useRef(nodes); nodesRef.current = nodes
  const connectionsRef = useRef(connections); connectionsRef.current = connections
  const connectingFromRef = useRef(connectingFrom); connectingFromRef.current = connectingFrom
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const panRef = useRef(pan); panRef.current = pan
  const selectedConnRef = useRef(selectedConn); selectedConnRef.current = selectedConn
  const selectedNodeRef = useRef(selectedNode); selectedNodeRef.current = selectedNode
  const editingNodeRef = useRef(editingNode); editingNodeRef.current = editingNode
  const editingConnRef = useRef(editingConn); editingConnRef.current = editingConn

  // ========== SUPABASE LOAD ==========
  useEffect(() => {
    if (!orgId) return
    const load = async () => {
      const { data } = await supabase
        .from('flowcharts')
        .select('*')
        .eq('organization_id', orgId)
        .order('updated_at', { ascending: false })
      if (data && data.length > 0) {
        const mapped: FlowChart[] = data.map((r: any) => ({
          id: r.id, name: r.name,
          nodes: r.nodes || [], connections: r.connections || [],
          custom_tags: r.custom_tags || [], updated_at: r.updated_at,
        }))
        setCharts(mapped)
        // Load first chart
        const first = mapped[0]
        setActiveChartId(first.id)
        setNodes(first.nodes); setConnections(first.connections)
        setChartName(first.name); setCustomTags(first.custom_tags)
      }
      setLoaded(true)
    }
    load()
  }, [orgId])

  // ========== SUPABASE SAVE (debounced) ==========
  const saveTimer = useRef<any>(null)
  const saveToSupabase = useCallback(async (chartId: string, data: Partial<FlowChart>) => {
    if (!orgId) return
    setSaving(true)
    await supabase.from('flowcharts').update({
      name: data.name, nodes: data.nodes, connections: data.connections,
      custom_tags: data.custom_tags, updated_at: new Date().toISOString(),
    }).eq('id', chartId)
    setSaving(false)
  }, [orgId, supabase])

  useEffect(() => {
    if (!loaded || !activeChartId) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      saveToSupabase(activeChartId, { name: chartName, nodes, connections, custom_tags: customTags })
    }, 1000)
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current) }
  }, [nodes, connections, chartName, customTags, loaded, activeChartId, saveToSupabase])

  // ========== CHART MANAGEMENT ==========
  const newChart = async () => {
    if (!orgId) return
    const { data } = await supabase.from('flowcharts').insert({
      organization_id: orgId, name: 'Untitled Flowchart',
      nodes: [], connections: [], custom_tags: [],
    }).select().single()
    if (data) {
      const chart: FlowChart = { id: data.id, name: data.name, nodes: [], connections: [], custom_tags: [] }
      setCharts(prev => [chart, ...prev])
      setActiveChartId(chart.id)
      setNodes([]); setConnections([]); setChartName(chart.name); setCustomTags([])
      setPan({ x: 0, y: 0 }); setZoom(1)
      setSelectedNode(null); setSelectedConn(null)
    }
  }

  const switchChart = (id: string) => {
    const chart = charts.find(c => c.id === id)
    if (!chart) return
    // Save current first
    if (activeChartId) {
      setCharts(prev => prev.map(c => c.id === activeChartId
        ? { ...c, name: chartName, nodes, connections, custom_tags: customTags }
        : c
      ))
    }
    setActiveChartId(chart.id)
    setNodes(chart.nodes || []); setConnections(chart.connections || [])
    setChartName(chart.name); setCustomTags(chart.custom_tags || [])
    setPan({ x: 0, y: 0 }); setZoom(1)
    setSelectedNode(null); setSelectedConn(null); setShowTagPicker(false)
  }

  const deleteChartFn = async (id: string) => {
    await supabase.from('flowcharts').delete().eq('id', id)
    const updated = charts.filter(c => c.id !== id)
    setCharts(updated)
    if (activeChartId === id) {
      if (updated.length > 0) switchChart(updated[0].id)
      else { setActiveChartId(null); setNodes([]); setConnections([]); setChartName('Untitled Flowchart'); setCustomTags([]) }
    }
  }

  // ========== NODE / CONNECTION LOGIC ==========
  const screenToCanvas = useCallback((sx: number, sy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: sx, y: sy }
    return { x: (sx - rect.left - pan.x) / zoom, y: (sy - rect.top - pan.y) / zoom }
  }, [pan, zoom])

  const addNode = (type: string) => {
    if (!activeChartId) { newChart(); return }
    const cfg = NODE_TYPES[type]
    const { w, h } = calcNodeSize(cfg.label, type, [])
    const cx = (400 - pan.x) / zoom, cy = (300 - pan.y) / zoom
    setNodes(prev => [...prev, {
      id: genId(), type, x: cx - w/2 + Math.random()*80-40,
      y: cy - h/2 + Math.random()*80-40, text: cfg.label, w, h, tags: [],
    }])
  }

  const toggleTag = (nodeId: string, tag: TagItem) => {
    setNodes(prev => prev.map(n => {
      if (n.id !== nodeId) return n
      const exists = (n.tags||[]).some(t => t.label === tag.label)
      const newTags = exists ? (n.tags||[]).filter(t => t.label !== tag.label) : [...(n.tags||[]), tag]
      const { w, h } = calcNodeSize(n.text, n.type, newTags)
      return { ...n, tags: newTags, w, h }
    }))
  }

  const duplicateNode = useCallback(() => {
    const id = selectedNodeRef.current
    if (!id) return
    const node = nodesRef.current.find(n => n.id === id)
    if (!node) return
    const nid = genId()
    setNodes(prev => [...prev, { ...node, id: nid, x: node.x+30, y: node.y+30, tags: [...(node.tags||[])] }])
    setSelectedNode(nid)
  }, [])

  const getConnEndpoints = useCallback((conn: FlowConn) => {
    const fn = nodesRef.current.find(n => n.id === conn.from)
    const tn = nodesRef.current.find(n => n.id === conn.to)
    if (!fn || !tn) return null
    return { from: getPort(fn, conn.fromSide), to: getPort(tn, conn.toSide), fromSide: conn.fromSide, toSide: conn.toSide }
  }, [])

  // ========== MOUSE HANDLERS ==========
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    const tag = (e.target as HTMLElement).tagName?.toLowerCase()
    const isBg = e.target === canvasRef.current || (e.target as HTMLElement).classList?.contains('canvas-inner') || ['svg','path','line','polygon'].includes(tag)
    if (!isBg) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (rect && connections.length > 0) {
      const cx = (e.clientX - rect.left - pan.x) / zoom, cy = (e.clientY - rect.top - pan.y) / zoom
      let closestC: FlowConn | null = null, closestD = Infinity
      for (const conn of connections) {
        const ep = getConnEndpoints(conn)
        if (!ep) continue
        const d = distToBezier(cx, cy, ep.from.x, ep.from.y, ep.to.x, ep.to.y, ep.fromSide, ep.toSide)
        if (d < closestD) { closestD = d; closestC = conn }
      }
      if (closestD < 14 && closestC) {
        e.stopPropagation()
        if (selectedConn === closestC.id) setEditingConn(closestC.id)
        else { setSelectedConn(closestC.id); setEditingConn(null) }
        setSelectedNode(null); setEditingNode(null); setShowTagPicker(false)
        return
      }
    }
    setSelectedNode(null); setSelectedConn(null); setEditingNode(null); setEditingConn(null); setShowTagPicker(false)
    if (e.button === 0) { setIsPanning(true); setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y }) }
  }

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isPanning && panStart) { setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y }); return }
    if (draggingNode) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const cx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current
      const cy = (e.clientY - rect.top - panRef.current.y) / zoomRef.current
      setNodes(prev => prev.map(n => n.id === draggingNode ? { ...n, x: cx - dragOffset.current.x, y: cy - dragOffset.current.y } : n))
      return
    }
    if (connectingFromRef.current) {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      setTempLineEnd({ x: (e.clientX - rect.left - panRef.current.x) / zoomRef.current, y: (e.clientY - rect.top - panRef.current.y) / zoomRef.current })
    }
  }, [isPanning, panStart, draggingNode])

  const handleMouseUp = useCallback((e: MouseEvent) => {
    setIsPanning(false); setPanStart(null); setDraggingNode(null)
    if (connectingFromRef.current) {
      const cf = connectingFromRef.current
      const rect = canvasRef.current?.getBoundingClientRect()
      if (rect) {
        const cx = (e.clientX - rect.left - panRef.current.x) / zoomRef.current
        const cy = (e.clientY - rect.top - panRef.current.y) / zoomRef.current
        for (const node of nodesRef.current) {
          if (node.id === cf.nodeId) continue
          if (cx >= node.x-16 && cx <= node.x+node.w+16 && cy >= node.y-16 && cy <= node.y+node.h+16) {
            setConnections(prev => [...prev, { id: genId(), from: cf.nodeId, to: node.id, fromSide: cf.side, toSide: closestPortSide(node, cx, cy), label: '' }])
            break
          }
        }
      }
      setConnectingFrom(null); setTempLineEnd(null)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('mouseup', handleMouseUp) }
  }, [handleMouseMove, handleMouseUp])

  const handleNodeMouseDown = (e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation()
    if (editingNode === nodeId) return
    if (selectedNode === nodeId) { setDraggingNode(null); setTimeout(() => setEditingNode(nodeId), 50); return }
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = (e.clientX - rect.left - pan.x) / zoom, cy = (e.clientY - rect.top - pan.y) / zoom
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    dragOffset.current = { x: cx - node.x, y: cy - node.y }
    setDraggingNode(nodeId); setSelectedNode(nodeId); setSelectedConn(null); setEditingConn(null); setShowTagPicker(false)
  }

  const startConnection = (e: React.MouseEvent, nodeId: string, side: string) => {
    e.stopPropagation(); e.preventDefault()
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return
    setConnectingFrom({ nodeId, side, port: getPort(node, side) }); setDraggingNode(null)
    setTempLineEnd(getPort(node, side))
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.min(3, Math.max(0.2, z * (e.deltaY > 0 ? 0.92 : 1.08))))
  }

  // ========== DELETE ==========
  const doDelete = useCallback(() => {
    const sc = selectedConnRef.current, sn = selectedNodeRef.current
    if (sc) { setConnections(p => p.filter(c => c.id !== sc)); setSelectedConn(null); setEditingConn(null) }
    else if (sn) { setNodes(p => p.filter(n => n.id !== sn)); setConnections(p => p.filter(c => c.from !== sn && c.to !== sn)); setSelectedNode(null) }
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (editingNodeRef.current) return
        if (editingConnRef.current) { setEditingConn(null); return }
        e.preventDefault(); doDelete()
      }
      if (e.key === 'Escape') {
        setSelectedNode(null); setSelectedConn(null); setEditingNode(null); setEditingConn(null)
        setConnectingFrom(null); setTempLineEnd(null); setShowTagPicker(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
        if (editingNodeRef.current || editingConnRef.current) return
        e.preventDefault(); duplicateNode()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [doDelete, duplicateNode])

  // ========== RENDERING ==========
  const PortDot = ({ nodeId, side }: { nodeId: string; side: string }) => {
    const node = nodes.find(n => n.id === nodeId)
    const col = node ? NODE_TYPES[node.type].color : C.accent
    return (
      <div onMouseDown={e => startConnection(e, nodeId, side)}
        className="absolute rounded-full cursor-crosshair z-20 transition-transform"
        style={{
          width: 14, height: 14, background: `${col}66`, border: `2.5px solid ${col}`,
          ...(side === 'top' && { top: -7, left: '50%', marginLeft: -7 }),
          ...(side === 'bottom' && { bottom: -7, left: '50%', marginLeft: -7 }),
          ...(side === 'left' && { left: -7, top: '50%', marginTop: -7 }),
          ...(side === 'right' && { right: -7, top: '50%', marginTop: -7 }),
        }}
        onMouseEnter={e => { (e.target as HTMLElement).style.transform = 'scale(1.5)'; (e.target as HTMLElement).style.background = col }}
        onMouseLeave={e => { (e.target as HTMLElement).style.transform = 'scale(1)'; (e.target as HTMLElement).style.background = `${col}66` }}
      />
    )
  }

  const NodeRenderer = ({ node }: { node: FlowNode }) => {
    const cfg = NODE_TYPES[node.type], col = cfg.color
    const sel = selectedNode === node.id, isEd = editingNode === node.id
    let br = '10px'
    if (node.type === 'start') br = '999px'
    const usesClip = node.type === 'decision' || node.type === 'data'
    let clipPath = 'none'
    if (node.type === 'decision') clipPath = 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)'
    if (node.type === 'data') clipPath = 'polygon(12% 0%, 100% 0%, 88% 100%, 0% 100%)'
    return (
      <div style={{ position: 'absolute', left: node.x, top: node.y, width: node.w, height: node.h, zIndex: sel ? 10 : 1, cursor: draggingNode === node.id ? 'grabbing' : 'grab' }}
        onMouseDown={e => handleNodeMouseDown(e, node.id)}>
        <div style={{ position: 'absolute', inset: 0, background: `${col}18`, border: usesClip ? 'none' : `2px solid ${sel ? '#fff' : col}`, borderRadius: usesClip ? 0 : br, clipPath, boxShadow: sel ? `0 0 0 2px ${col}66, 0 4px 20px ${col}33` : '0 2px 8px rgba(0,0,0,0.3)' }} />
        {usesClip && (
          <svg style={{ position: 'absolute', inset: -2, width: node.w+4, height: node.h+4, pointerEvents: 'none', overflow: 'visible' }}>
            {node.type === 'decision'
              ? <polygon points={`${(node.w+4)/2},1 ${node.w+3},${(node.h+4)/2} ${(node.w+4)/2},${node.h+3} 1,${(node.h+4)/2}`} fill="none" stroke={sel?'#fff':col} strokeWidth="2" />
              : <polygon points={`${(node.w+4)*0.12},1 ${node.w+3},1 ${(node.w+4)*0.88},${node.h+3} 1,${node.h+3}`} fill="none" stroke={sel?'#fff':col} strokeWidth="2" />
            }
          </svg>
        )}
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: node.type==='decision'?'24% 28%':node.type==='start'?'8px 20px':'8px 16px', pointerEvents: 'none', gap: 4 }}>
          <span style={{ color: '#fff', fontSize: node.type==='decision'?'12px':'13px', fontWeight: 500, textAlign: 'center', lineHeight: 1.4, userSelect: 'none', width: '100%', wordBreak: 'break-word', opacity: isEd ? 0.3 : 1 }}>{node.text}</span>
          {node.tags?.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, justifyContent: 'center' }}>
              {node.tags.map(tag => (
                <span key={tag.label} style={{ fontSize: '9px', fontWeight: 700, color: '#fff', background: tag.color, padding: '1px 6px', borderRadius: 3, letterSpacing: '0.03em', lineHeight: 1.4, whiteSpace: 'nowrap', textTransform: 'uppercase' }}>{tag.label}</span>
              ))}
            </div>
          )}
        </div>
        <PortDot side="top" nodeId={node.id} /><PortDot side="bottom" nodeId={node.id} />
        <PortDot side="left" nodeId={node.id} /><PortDot side="right" nodeId={node.id} />
      </div>
    )
  }

  const renderConnections = () => {
    const lines = connections.map(conn => {
      const ep = getConnEndpoints(conn)
      if (!ep) return null
      const d = makePath(ep.from.x, ep.from.y, ep.to.x, ep.to.y, ep.fromSide, ep.toSide)
      const isSel = selectedConn === conn.id
      return (
        <g key={conn.id}>
          <path d={d} fill="none" stroke={isSel?'#fff':'#4B5EAA'} strokeWidth={isSel?3:2} markerEnd={isSel?'url(#arrowSel)':'url(#arrow)'} style={{ pointerEvents: 'none' }} />
        </g>
      )
    })
    let tempPath = null
    if (connectingFrom?.port && tempLineEnd) {
      const d = makePath(connectingFrom.port.x, connectingFrom.port.y, tempLineEnd.x, tempLineEnd.y, connectingFrom.side, 'top')
      tempPath = <path d={d} fill="none" stroke="#3B82F6" strokeWidth={2} strokeDasharray="6 4" opacity={0.8} style={{ pointerEvents: 'none' }} />
    }
    return (
      <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', overflow: 'visible', pointerEvents: 'none' }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto"><path d="M 0 0 L 10 4 L 0 8 Z" fill="#4B5EAA" /></marker>
          <marker id="arrowSel" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto"><path d="M 0 0 L 10 4 L 0 8 Z" fill="#fff" /></marker>
        </defs>
        {lines}{tempPath}
      </svg>
    )
  }

  const renderNodeTextEditor = () => {
    if (!editingNode) return null
    const node = nodes.find(n => n.id === editingNode)
    if (!node) return null
    const col = NODE_TYPES[node.type].color
    const sx = node.x*zoom+pan.x, sy = node.y*zoom+pan.y, sw = node.w*zoom, sh = node.h*zoom
    return (
      <div style={{ position: 'absolute', left: sx+sw/2-100, top: sy+sh/2-18, zIndex: 200 }} onMouseDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
        <input autoFocus value={node.text}
          onChange={e => { const v = e.target.value; const cur = nodes.find(n => n.id === editingNode); if (!cur) return; const { w, h } = calcNodeSize(v, cur.type, cur.tags); setNodes(prev => prev.map(n => n.id === editingNode ? { ...n, text: v, w, h } : n)) }}
          onBlur={() => setEditingNode(null)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingNode(null); e.stopPropagation() }}
          style={{ width: 200, background: C.surface, border: `2px solid ${col}`, borderRadius: 6, color: '#fff', fontSize: '14px', fontWeight: 600, textAlign: 'center', padding: '8px 12px', outline: 'none', fontFamily: 'inherit', boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 0 1px ${col}44` }}
        />
      </div>
    )
  }

  const renderConnLabelEditor = () => {
    if (!editingConn) return null
    const conn = connections.find(c => c.id === editingConn)
    if (!conn) return null
    const ep = getConnEndpoints(conn)
    if (!ep) return null
    const mx = ((ep.from.x+ep.to.x)/2)*zoom+pan.x, my = ((ep.from.y+ep.to.y)/2)*zoom+pan.y
    return (
      <div style={{ position: 'absolute', left: mx-65, top: my-36, zIndex: 100 }} onMouseDown={e => e.stopPropagation()}>
        <input autoFocus value={conn.label||''} placeholder="Label (Yes / No)"
          onChange={e => setConnections(prev => prev.map(c => c.id === conn.id ? { ...c, label: e.target.value } : c))}
          onBlur={() => setEditingConn(null)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === 'Escape') setEditingConn(null); e.stopPropagation() }}
          style={{ width: 130, background: C.surface, border: `2px solid ${C.accent}`, borderRadius: 6, color: C.text, fontSize: '12px', padding: '6px 10px', textAlign: 'center', outline: 'none', fontFamily: 'inherit', boxShadow: '0 4px 16px rgba(0,0,0,0.5)' }}
        />
      </div>
    )
  }

  const gridSize = 24
  const sidebarCharts = [...charts].sort((a, b) => (b.updated_at || '') > (a.updated_at || '') ? 1 : -1)

  if (!loaded && orgId) return <div className="flex items-center justify-center h-screen" style={{ background: C.bg }}><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>

  // ========== RENDER ==========
  return (
    <div className="flex h-[calc(100vh-64px)]" style={{ background: C.bg, fontFamily: "'Inter', sans-serif", color: C.text }}>

      {/* Sidebar */}
      {showSidebar && (
        <div className="flex flex-col flex-shrink-0" style={{ width: 240, background: C.surface, borderRight: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between p-4" style={{ borderBottom: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2">
              <GitBranch size={16} className="text-blue-400" />
              <span className="font-bold text-sm">Flow Builder</span>
            </div>
            <button onClick={() => setShowSidebar(false)} className="text-gray-500 hover:text-white"><PanelLeftClose size={16} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            <p className="text-[10px] uppercase tracking-wider px-2 pt-2 pb-1 font-semibold" style={{ color: C.textMuted }}>Charts</p>
            {sidebarCharts.map(c => (
              <div key={c.id} onClick={() => switchChart(c.id)}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer mb-0.5"
                style={{ background: c.id === activeChartId ? `${C.accent}22` : 'transparent', border: `1px solid ${c.id === activeChartId ? C.accent+'44' : 'transparent'}` }}>
                <span className="text-[13px] truncate max-w-[160px]" style={{ fontWeight: c.id === activeChartId ? 600 : 400 }}>{c.name}</span>
                <button onClick={e => { e.stopPropagation(); if (confirm('Delete this chart?')) deleteChartFn(c.id) }}
                  className="text-gray-500 hover:text-red-400 opacity-40 hover:opacity-100"><X size={14} /></button>
              </div>
            ))}
            <button onClick={newChart} className="w-full py-2.5 mt-1 rounded-lg text-[13px] cursor-pointer transition-colors"
              style={{ background: 'transparent', border: `1px dashed ${C.border}`, color: C.textMuted }}>
              <Plus size={14} className="inline mr-1" />New Chart
            </button>
          </div>

          {/* Node palette */}
          <div style={{ borderTop: `1px solid ${C.border}` }} className="p-2">
            <p className="text-[10px] uppercase tracking-wider px-2 pb-2 font-semibold" style={{ color: C.textMuted }}>Add Nodes</p>
            <div className="grid grid-cols-2 gap-1">
              {Object.entries(NODE_TYPES).map(([key, cfg]) => (
                <button key={key} onClick={() => addNode(key)}
                  className="py-2 px-1 rounded-lg cursor-pointer text-[11px] font-semibold transition-colors"
                  style={{ background: `${cfg.color}12`, border: `1px solid ${cfg.color}33`, color: cfg.color }}>
                  {cfg.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${C.border}` }} className="p-3 text-[11px] leading-relaxed" >
            <p className="font-semibold text-white mb-1">Controls</p>
            <p style={{ color: C.textMuted }}>Drag node to move • Drag dot to connect<br/>Click node → select • Click again → edit<br/>Click arrow → select • ⌘D = duplicate<br/>Delete key = remove selected</p>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2.5 px-4 flex-shrink-0" style={{ height: 48, background: C.surface, borderBottom: `1px solid ${C.border}` }}>
          {!showSidebar && <button onClick={() => setShowSidebar(true)} className="p-1.5 rounded border" style={{ borderColor: C.border, color: C.textMuted }}><PanelLeftOpen size={16} /></button>}
          {activeChartId && <input value={chartName} onChange={e => setChartName(e.target.value)} className="bg-transparent border-none outline-none text-sm font-semibold w-60" style={{ color: C.text }} placeholder="Chart name..." />}
          {saving && <Loader2 size={14} className="animate-spin text-blue-400" />}
          <div className="flex-1" />
          {connectingFrom && <span className="text-xs font-semibold px-3 py-1 rounded-md" style={{ color: C.accent, background: `${C.accent}15`, border: `1px solid ${C.accent}33` }}>Drop on a node to connect</span>}
          {selectedConn && !editingConn && <span className="text-xs text-amber-400">Arrow selected</span>}
          <span className="text-[11px]" style={{ color: C.textMuted }}>{Math.round(zoom*100)}%</span>
          <button onClick={() => setZoom(z => Math.min(3, z*1.2))} className="p-1 rounded border" style={{ borderColor: C.border, color: C.textMuted }}><ZoomIn size={14} /></button>
          <button onClick={() => setZoom(z => Math.max(0.2, z/1.2))} className="p-1 rounded border" style={{ borderColor: C.border, color: C.textMuted }}><ZoomOut size={14} /></button>
          <button onClick={() => { setZoom(1); setPan({x:0,y:0}) }} className="p-1 rounded border text-[11px]" style={{ borderColor: C.border, color: C.textMuted }}><RotateCcw size={14} /></button>
          {selectedNode && !editingNode && <button onClick={() => setTimeout(() => setEditingNode(selectedNode), 50)} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}44`, color: C.accent }}><Pencil size={12} className="inline mr-1" />Edit</button>}
          {selectedNode && <button onClick={() => setShowTagPicker(v => !v)} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: '#8B5CF622', border: '1px solid #8B5CF644', color: '#8B5CF6' }}><Tag size={12} className="inline mr-1" />Tags</button>}
          {selectedNode && <button onClick={duplicateNode} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: '#10B98122', border: '1px solid #10B98144', color: '#10B981' }}><Copy size={12} className="inline mr-1" />Dup</button>}
          {selectedConn && !editingConn && <button onClick={() => setEditingConn(selectedConn)} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: `${C.accent}22`, border: `1px solid ${C.accent}44`, color: C.accent }}>Label</button>}
          {(selectedNode || selectedConn) && <button onClick={doDelete} className="px-2.5 py-1 rounded text-xs font-semibold" style={{ background: '#EF444422', border: '1px solid #EF444444', color: '#EF4444' }}><Trash2 size={12} className="inline mr-1" />Del</button>}
        </div>

        {/* Canvas */}
        <div ref={canvasRef} onMouseDown={handleCanvasMouseDown} onWheel={handleWheel}
          className="flex-1 relative overflow-hidden"
          style={{ cursor: isPanning?'grabbing':connectingFrom?'crosshair':'default', backgroundImage: `radial-gradient(circle, ${C.grid} 1px, transparent 1px)`, backgroundSize: `${gridSize*zoom}px ${gridSize*zoom}px`, backgroundPosition: `${pan.x}px ${pan.y}px` }}>

          {!activeChartId && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 z-[5]">
              <p className="text-base" style={{ color: C.textMuted }}>Create a new chart to get started</p>
              <button onClick={newChart} className="px-6 py-2.5 rounded-lg font-semibold text-sm text-white" style={{ background: C.accent }}>
                <Plus size={16} className="inline mr-1" />New Chart
              </button>
            </div>
          )}

          {activeChartId && (
            <div className="canvas-inner absolute" style={{ transformOrigin: '0 0', transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: 5000, height: 5000 }}>
              {renderConnections()}
              {/* Floating arrow labels */}
              {connections.map(conn => {
                if (!conn.label) return null
                const ep = getConnEndpoints(conn)
                if (!ep) return null
                const mx = (ep.from.x+ep.to.x)/2, my = (ep.from.y+ep.to.y)/2
                return <div key={'lbl-'+conn.id} style={{ position: 'absolute', left: mx, top: my-12, transform: 'translate(-50%,-50%)', pointerEvents: 'none', zIndex: 2 }}>
                  <span style={{ background: C.surface, color: C.text, fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: 4, border: `1px solid ${C.border}`, whiteSpace: 'nowrap' }}>{conn.label}</span>
                </div>
              })}
              {nodes.map(node => <NodeRenderer key={node.id} node={node} />)}
            </div>
          )}

          {renderConnLabelEditor()}
          {renderNodeTextEditor()}

          {/* Tag picker */}
          {showTagPicker && selectedNode && (() => {
            const node = nodes.find(n => n.id === selectedNode)
            if (!node) return null
            const sx = node.x*zoom+pan.x, sy = node.y*zoom+pan.y+node.h*zoom
            const allTags = [...TAG_PRESETS, ...customTags]
            return (
              <div className="absolute rounded-lg p-2 overflow-y-auto" style={{ left: sx, top: sy+4, zIndex: 300, background: C.surface, border: `1px solid ${C.border}`, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', minWidth: 180, maxHeight: 360 }} onMouseDown={e => e.stopPropagation()}>
                <p className="text-[10px] uppercase tracking-wider px-1 pb-1.5 font-semibold" style={{ color: C.textMuted }}>Toggle Tags</p>
                <div className="flex flex-col gap-0.5">
                  {allTags.map(tag => {
                    const active = (node.tags||[]).some(t => t.label === tag.label)
                    const isCustom = customTags.some(t => t.label === tag.label)
                    return (
                      <div key={tag.label} className="flex items-center">
                        <button onClick={() => toggleTag(node.id, tag)} className="flex items-center gap-2 px-2 py-1.5 rounded-md flex-1 text-left text-xs font-medium"
                          style={{ background: active ? `${tag.color}22` : 'transparent', border: `1px solid ${active ? tag.color+'66' : 'transparent'}`, color: active ? '#fff' : C.textMuted }}>
                          <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ background: tag.color }} />
                          {tag.label}
                          {active && <span className="ml-auto">✓</span>}
                        </button>
                        {isCustom && <button onClick={() => { setCustomTags(p => p.filter(t => t.label !== tag.label)); setNodes(p => p.map(n => { const f = (n.tags||[]).filter(t => t.label !== tag.label); const { w, h } = calcNodeSize(n.text, n.type, f); return { ...n, tags: f, w, h } })) }} className="text-gray-500 hover:text-red-400 px-1 text-sm opacity-40 hover:opacity-100">×</button>}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${C.border}` }}>
                  <p className="text-[10px] uppercase tracking-wider px-1 pb-1.5 font-semibold" style={{ color: C.textMuted }}>Create Tag</p>
                  <input value={newTagLabel} onChange={e => setNewTagLabel(e.target.value)} placeholder="Tag name..."
                    onKeyDown={e => {
                      if (e.key === 'Enter' && newTagLabel.trim()) {
                        const exists = [...TAG_PRESETS, ...customTags].some(t => t.label.toLowerCase() === newTagLabel.trim().toLowerCase())
                        if (!exists) { const tag = { label: newTagLabel.trim(), color: newTagColor }; setCustomTags(p => [...p, tag]); toggleTag(node.id, tag); setNewTagLabel('') }
                      }
                      e.stopPropagation()
                    }}
                    className="w-full rounded px-2 py-1.5 text-xs mb-2 outline-none" style={{ background: C.bg, border: `1px solid ${C.border}`, color: C.text }}
                  />
                  <div className="flex gap-1 flex-wrap mb-2">
                    {TAG_COLORS.map(c => <button key={c} onClick={() => setNewTagColor(c)} className="rounded" style={{ width: 18, height: 18, background: c, outline: newTagColor === c ? '2px solid #fff' : 'none', outlineOffset: 1 }} />)}
                  </div>
                  <button onClick={() => {
                    if (!newTagLabel.trim()) return
                    const exists = [...TAG_PRESETS, ...customTags].some(t => t.label.toLowerCase() === newTagLabel.trim().toLowerCase())
                    if (exists) return
                    const tag = { label: newTagLabel.trim(), color: newTagColor }
                    setCustomTags(p => [...p, tag]); toggleTag(node.id, tag); setNewTagLabel('')
                  }} className="w-full py-1.5 rounded text-xs font-semibold" style={{ background: `${newTagColor}22`, border: `1px solid ${newTagColor}44`, color: newTagColor }}>+ Add Tag</button>
                </div>
                <button onClick={() => setShowTagPicker(false)} className="w-full mt-1.5 py-1 rounded text-[11px]" style={{ background: 'transparent', border: `1px solid ${C.border}`, color: C.textMuted }}>Close</button>
              </div>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
