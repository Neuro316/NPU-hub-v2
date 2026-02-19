'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import {
  fetchNetworkGraph, fetchRelationshipTypes, fetchTagCategories,
  createRelationship, deleteRelationship, updateRelationship, seedNetworkIntelligence,
  computeNetworkScores, findBridgeContacts
} from '@/lib/crm-client'
import type {
  NetworkGraphData, NetworkNode, NetworkEdge, NetworkCluster,
  NetworkInsight, RelationshipType, ContactTagCategory
} from '@/types/crm'
import {
  Search, Filter, Sparkles, Users, GitBranch, X, Plus, Trash2,
  Loader2, Star, Zap, AlertTriangle, Calendar, ChevronRight,
  ChevronDown, Maximize2, RefreshCw, Eye, EyeOff, Target,
  Crosshair, List, LayoutGrid, Phone, Mail, MapPin, ZoomIn, ZoomOut, Link, ExternalLink, Pencil
} from 'lucide-react'

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════
const CLUSTER_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#64748b',
]

const INSIGHT_ICONS: Record<string, any> = {
  bridge_opportunity: GitBranch,
  dormant_connector: AlertTriangle,
  cluster_gap: Target,
  referral_chain: ChevronRight,
  event_suggestion: Calendar,
  engagement_alert: Zap,
  network_gap: Eye,
  social_suggestion: Star,
}

// ═══════════════════════════════════════════════════════════════
// FORCE SIMULATION
// ═══════════════════════════════════════════════════════════════
interface SimNode extends NetworkNode {
  x: number; y: number; vx: number; vy: number
  fx?: number; fy?: number
}

function initSimulation(nodes: NetworkNode[], w: number, h: number): SimNode[] {
  const cx = w / 2, cy = h / 2
  return nodes.map((n, i) => {
    const angle = (2 * Math.PI * i) / (nodes.length || 1)
    const r = Math.min(w, h) * 0.38
    return {
      ...n,
      x: cx + r * Math.cos(angle) + (Math.random() - 0.5) * 40,
      y: cy + r * Math.sin(angle) + (Math.random() - 0.5) * 40,
      vx: 0, vy: 0,
    }
  })
}

function tickSim(nodes: SimNode[], edges: NetworkEdge[], w: number, h: number) {
  const repulsion = 8000, attraction = 0.003, gravity = 0.006, damping = 0.82
  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].fx !== undefined) continue
    let fx = 0, fy = 0
    // center gravity
    fx += (w / 2 - nodes[i].x) * gravity
    fy += (h / 2 - nodes[i].y) * gravity
    // repulsion
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue
      const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y
      const dist = Math.sqrt(dx * dx + dy * dy) || 1
      const force = repulsion / (dist * dist)
      fx += (dx / dist) * force; fy += (dy / dist) * force
    }
    // edge attraction
    edges.forEach(e => {
      let other: SimNode | undefined
      if (e.from === nodes[i].id) other = nodeMap.get(e.to)
      else if (e.to === nodes[i].id) other = nodeMap.get(e.from)
      if (other) {
        const dx = other.x - nodes[i].x, dy = other.y - nodes[i].y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const str = (e.strength || 3)
        fx += (dx / dist) * (dist - 140) * attraction * str
        fy += (dy / dist) * (dist - 140) * attraction * str
      }
    })
    nodes[i].vx = (nodes[i].vx + fx) * damping
    nodes[i].vy = (nodes[i].vy + fy) * damping
    nodes[i].x += nodes[i].vx
    nodes[i].y += nodes[i].vy
    nodes[i].x = Math.max(30, Math.min(w - 30, nodes[i].x))
    nodes[i].y = Math.max(30, Math.min(h - 30, nodes[i].y))
  }
  // apply fixed positions
  nodes.forEach(n => {
    if (n.fx !== undefined) { n.x = n.fx; n.vx = 0 }
    if (n.fy !== undefined) { n.y = n.fy; n.vy = 0 }
  })
}

// ═══════════════════════════════════════════════════════════════
// TAG PILL
// ═══════════════════════════════════════════════════════════════
function TagPill({ name, color, small }: { name: string; color?: string; small?: boolean }) {
  const c = color || '#94a3b8'
  return (
    <span
      className={`inline-flex items-center rounded-full font-medium whitespace-nowrap ${
        small ? 'text-[7px] px-1.5 py-0' : 'text-[8px] px-2 py-0.5'
      }`}
      style={{ background: c + '15', color: c, border: `1px solid ${c}30` }}
    >
      {name}
    </span>
  )
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function NetworkPage() {
  const { currentOrg, user, loading: orgLoading } = useWorkspace()

  // Core data
  const [graphData, setGraphData] = useState<NetworkGraphData | null>(null)
  const [simNodes, setSimNodes] = useState<SimNode[]>([])
  const [loading, setLoading] = useState(true)
  const [relTypes, setRelTypes] = useState<RelationshipType[]>([])
  const [tagCategories, setTagCategories] = useState<ContactTagCategory[]>([])

  // View state
  const [viewMode, setViewMode] = useState<'graph' | 'list'>('graph')
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showOrphans, setShowOrphans] = useState(true)
  const [activeTagFilters, setActiveTagFilters] = useState<Set<string>>(new Set())
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())

  // Event planner
  const [eventMode, setEventMode] = useState(false)
  const [eventContacts, setEventContacts] = useState<Set<string>>(new Set())
  const [bridgeContacts, setBridgeContacts] = useState<string[]>([])

  // AI Insights
  const [insights, setInsights] = useState<NetworkInsight[]>([])
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [insightsLoading, setInsightsLoading] = useState(false)

  // Add relationship
  const [addRelOpen, setAddRelOpen] = useState(false)
  const [addRelFrom, setAddRelFrom] = useState('')
  const [addRelTo, setAddRelTo] = useState('')
  const [addRelType, setAddRelType] = useState('')
  const [addRelNotes, setAddRelNotes] = useState('')
  const [addRelStrength, setAddRelStrength] = useState(3)

  // Pathfinder - find connection chain between two people
  const [pathMode, setPathMode] = useState(false)
  const [pathFrom, setPathFrom] = useState<string | null>(null)
  const [pathTo, setPathTo] = useState<string | null>(null)
  const [pathResult, setPathResult] = useState<string[]>([])
  const [showContactInfo, setShowContactInfo] = useState(true)
  const [editingEdge, setEditingEdge] = useState<string | null>(null)
  const [editStrength, setEditStrength] = useState(3)

  // Canvas
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef = useRef<number>(0)
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 })
  const prevCanvasSize = useRef({ w: 800, h: 600 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [dragging, setDragging] = useState<string | null>(null)
  const [panning, setPanning] = useState(false)
  const lastMouse = useRef({ x: 0, y: 0 })

  // ── Load data ──
  const loadData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    try {
      await seedNetworkIntelligence(currentOrg.id).catch(() => {})
      await computeNetworkScores(currentOrg.id).catch(() => {})
      const [graph, types, cats] = await Promise.all([
        fetchNetworkGraph(currentOrg.id),
        fetchRelationshipTypes(currentOrg.id),
        fetchTagCategories(),
      ])
      setGraphData(graph)
      setRelTypes(types)
      setTagCategories(cats)
    } catch (err) {
      console.error('Failed to load network:', err)
    }
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { loadData() }, [loadData])

  // ── Init simulation (only when graph data changes, not canvas resize) ──
  useEffect(() => {
    if (!graphData) return
    const w = containerRef.current?.clientWidth || canvasSize.w
    const h = containerRef.current?.clientHeight || canvasSize.h
    setSimNodes(initSimulation(graphData.nodes, w, h))
    prevCanvasSize.current = { w, h }
  }, [graphData])

  // ── Canvas resize (ResizeObserver) ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const obs = new ResizeObserver(entries => {
      for (const e of entries) {
        const newW = e.contentRect.width
        const newH = e.contentRect.height
        if (newW > 0 && newH > 0) {
          const oldW = prevCanvasSize.current.w
          const oldH = prevCanvasSize.current.h
          // Rescale node positions to fit new canvas size
          if (oldW > 0 && oldH > 0 && (Math.abs(newW - oldW) > 20 || Math.abs(newH - oldH) > 20)) {
            setSimNodes(prev => prev.map(n => ({
              ...n,
              x: (n.x / oldW) * newW,
              y: (n.y / oldH) * newH,
            })))
          }
          prevCanvasSize.current = { w: newW, h: newH }
          setCanvasSize({ w: newW, h: newH })
        }
      }
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Compute bridge contacts ──
  useEffect(() => {
    if (!graphData || eventContacts.size < 2) { setBridgeContacts([]); return }
    setBridgeContacts(findBridgeContacts(eventContacts, graphData.edges, graphData.nodes))
  }, [eventContacts, graphData])

  // ── Tag color lookup ──
  const tagColorMap = useMemo(() => {
    const m = new Map<string, string>()
    tagCategories.forEach(cat => {
      (cat.tags || []).forEach(t => m.set(t.name, cat.color))
    })
    return m
  }, [tagCategories])

  // ── Visible / filtered nodes ──
  const visibleNodes = useMemo(() => {
    let filtered = simNodes
    if (search) {
      const q = search.toLowerCase()
      filtered = filtered.filter(n =>
        n.name.toLowerCase().includes(q) || n.tags.some(t => t.toLowerCase().includes(q))
      )
    }
    if (activeTagFilters.size > 0) {
      filtered = filtered.filter(n => n.tags.some(t => activeTagFilters.has(t)))
    }
    if (!showOrphans) {
      const connected = new Set<string>()
      graphData?.edges.forEach(e => { connected.add(e.from); connected.add(e.to) })
      filtered = filtered.filter(n => connected.has(n.id))
    }
    return filtered
  }, [simNodes, search, activeTagFilters, showOrphans, graphData])

  const visibleIds = useMemo(() => new Set(visibleNodes.map(n => n.id)), [visibleNodes])

  // ── Connected IDs for selection highlight ──
  const connectedIds = useMemo(() => {
    if (!selectedNode || !graphData) return new Set<string>()
    const ids = new Set([selectedNode])
    graphData.edges.forEach(e => {
      if (e.from === selectedNode) ids.add(e.to)
      if (e.to === selectedNode) ids.add(e.from)
    })
    return ids
  }, [selectedNode, graphData])

  // ═══════════════════════════════════════════════════════════════
  // CANVAS DRAWING
  // ═══════════════════════════════════════════════════════════════
  const drawGraph = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = canvasSize.w * dpr
    canvas.height = canvasSize.h * dpr
    ctx.scale(dpr, dpr)
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)

    ctx.save()
    ctx.translate(pan.x, pan.y)
    ctx.scale(zoom, zoom)

    const nodeMap = new Map(simNodes.map(n => [n.id, n]))

    // Auto-scale bubble size based on node count and viewport
    const area = canvasSize.w * canvasSize.h
    const nodeCount = Math.max(1, visibleNodes.length)
    const scaleFactor = Math.min(1.8, Math.max(0.6, Math.sqrt(area / (nodeCount * 3000))))

    // ── Draw edges (solid lines) ──
    graphData?.edges.forEach(edge => {
      const a = nodeMap.get(edge.from), b = nodeMap.get(edge.to)
      if (!a || !b) return
      if (!visibleIds.has(a.id) && !visibleIds.has(b.id)) return

      const isSelected = selectedNode === a.id || selectedNode === b.id
      const isBothEvent = eventContacts.has(a.id) && eventContacts.has(b.id)

      ctx.beginPath()
      ctx.moveTo(a.x, a.y)
      ctx.lineTo(b.x, b.y)

      if (isBothEvent) {
        ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.5; ctx.globalAlpha = 1
      } else if (isSelected) {
        ctx.strokeStyle = edge.color || '#6366f1'; ctx.lineWidth = 2; ctx.globalAlpha = 0.9
      } else {
        ctx.strokeStyle = edge.color || '#94a3b8'; ctx.lineWidth = 1.2; ctx.globalAlpha = selectedNode ? 0.08 : 0.35
      }
      ctx.stroke()

      // Edge label on selected
      if (isSelected || isBothEvent) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
        ctx.font = '500 8px system-ui'
        ctx.fillStyle = isBothEvent ? '#d97706' : edge.color || '#6366f1'
        ctx.textAlign = 'center'
        ctx.globalAlpha = 1
        ctx.fillText(edge.label || edge.type, mx, my - 5)
      }
      ctx.globalAlpha = 1
    })

    // ── Draw nodes ──
    simNodes.forEach(node => {
      if (!visibleIds.has(node.id)) return

      const isSelected = selectedNode === node.id
      const isHovered = hoveredNode === node.id
      const isConnected = connectedIds.has(node.id)
      const isEventTarget = eventContacts.has(node.id)
      const isBridge = bridgeContacts.includes(node.id)
      const isDim = selectedNode && !isSelected && !isConnected

      const baseR = Math.max(12, Math.min(28, (12 + (node.relationship_count || 0) * 1.8) * scaleFactor))
      const r = isSelected ? baseR + 4 : isHovered ? baseR + 2 : baseR

      if (isDim) ctx.globalAlpha = 0.15

      // Glow on selected/hovered
      if ((isSelected || isHovered || isBridge) && !isDim) {
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 6, 0, Math.PI * 2)
        const grd = ctx.createRadialGradient(node.x, node.y, r, node.x, node.y, r + 6)
        const glowColor = isBridge ? 'rgba(245,158,11,' : isSelected ? 'rgba(99,102,241,' : 'rgba(100,116,139,'
        grd.addColorStop(0, glowColor + '0.2)')
        grd.addColorStop(1, 'transparent')
        ctx.fillStyle = grd
        ctx.fill()
      }

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)

      let fillColor: string
      if (isBridge) fillColor = '#f59e0b'
      else if (isEventTarget) fillColor = '#10b981'
      else if (node.cluster_id !== undefined) fillColor = CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length]
      else fillColor = '#94a3b8'

      ctx.fillStyle = fillColor
      ctx.fill()

      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? '#1e293b' : '#64748b'
        ctx.lineWidth = isSelected ? 2.5 : 1.5
        ctx.stroke()
      }

      // Initials
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${Math.max(8, r * 0.75)}px system-ui`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(node.avatar, node.x, node.y)

      // Name label (always for selected, hovered, or zoomed, or small graphs)
      if (isSelected || isHovered || zoom > 1.1 || simNodes.length < 30) {
        ctx.font = `${isSelected ? '600' : '400'} ${isSelected ? 10 : 9}px system-ui`
        ctx.fillStyle = isDim ? '#94a3b8' : isSelected ? '#312e81' : '#475569'
        ctx.fillText(node.name.split(' ')[0], node.x, node.y + r + 11)
      }

      ctx.globalAlpha = 1
    })

    ctx.restore()
  }, [simNodes, graphData, selectedNode, hoveredNode, eventContacts, bridgeContacts, connectedIds, visibleIds, zoom, pan, canvasSize])

  // ── Animation loop ──
  useEffect(() => {
    if (!graphData || simNodes.length === 0 || viewMode !== 'graph') return
    let running = true
    const animate = () => {
      if (!running) return
      tickSim(simNodes, graphData.edges, canvasSize.w, canvasSize.h)
      drawGraph()
      animRef.current = requestAnimationFrame(animate)
    }
    animate()
    return () => { running = false; cancelAnimationFrame(animRef.current) }
  }, [simNodes, graphData, viewMode, drawGraph, canvasSize])

  // ═══════════════════════════════════════════════════════════════
  // CANVAS MOUSE HANDLERS
  // ═══════════════════════════════════════════════════════════════
  const screenToWorld = (sx: number, sy: number) => ({
    x: (sx - pan.x) / zoom, y: (sy - pan.y) / zoom,
  })

  const findNodeAt = (wx: number, wy: number): SimNode | null => {
    const area = canvasSize.w * canvasSize.h
    const nodeCount = Math.max(1, visibleNodes.length)
    const scaleFactor = Math.min(1.8, Math.max(0.6, Math.sqrt(area / (nodeCount * 3000))))
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const n = simNodes[i]
      if (!visibleIds.has(n.id)) continue
      const r = Math.max(12, Math.min(28, (12 + (n.relationship_count || 0) * 1.8) * scaleFactor))
      if (Math.hypot(wx - n.x, wy - n.y) < r + 5) return n
    }
    return null
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
    const node = findNodeAt(x, y)
    if (node) {
      setDragging(node.id)
      node.fx = node.x; node.fy = node.y
    } else {
      setPanning(true)
    }
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    if (dragging) {
      const node = simNodes.find(n => n.id === dragging)
      if (node) {
        const dx = (e.clientX - lastMouse.current.x) / zoom
        const dy = (e.clientY - lastMouse.current.y) / zoom
        node.fx = (node.fx || node.x) + dx; node.fy = (node.fy || node.y) + dy
        node.x = node.fx; node.y = node.fy
      }
    } else if (panning) {
      setPan(p => ({
        x: p.x + (e.clientX - lastMouse.current.x),
        y: p.y + (e.clientY - lastMouse.current.y),
      }))
    } else {
      const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
      const node = findNodeAt(x, y)
      setHoveredNode(node?.id || null)
      if (canvasRef.current) canvasRef.current.style.cursor = node ? 'pointer' : 'default'
    }
    lastMouse.current = { x: e.clientX, y: e.clientY }
  }

  const handleMouseUp = () => {
    if (dragging) {
      const node = simNodes.find(n => n.id === dragging)
      if (node) { delete node.fx; delete node.fy }
    }
    setDragging(null); setPanning(false)
  }

  const handleCanvasClick = (e: React.MouseEvent) => {
    if (dragging) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const { x, y } = screenToWorld(e.clientX - rect.left, e.clientY - rect.top)
    const node = findNodeAt(x, y)
    if (node) {
      if (pathMode) {
        if (!pathFrom) { setPathFrom(node.id) }
        else if (!pathTo && node.id !== pathFrom) { setPathTo(node.id) }
        else { setPathFrom(node.id); setPathTo(null); setPathResult([]) }
      } else if (eventMode) {
        setEventContacts(prev => {
          const next = new Set(prev)
          next.has(node.id) ? next.delete(node.id) : next.add(node.id)
          return next
        })
      } else {
        setSelectedNode(selectedNode === node.id ? null : node.id)
      }
    } else {
      setSelectedNode(null)
    }
  }

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    setZoom(z => Math.max(0.3, Math.min(3, z * (e.deltaY > 0 ? 0.92 : 1.08))))
  }

  // ═══════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════
  const generateInsights = async () => {
    if (!graphData) return
    setInsightsLoading(true)
    try {
      const res = await fetch('/api/crm/network/insights', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ graphData }),
      })
      const data = await res.json()
      if (!res.ok) {
        console.error('Insights error:', data.error)
        setInsights([{
          type: 'engagement_alert', title: 'Analysis Unavailable',
          description: data.error || 'Could not generate insights. Check that ANTHROPIC_API_KEY is configured in your environment variables.',
          contact_ids: [], confidence: 0, priority: 'low'
        }])
      } else {
        setInsights(data.insights || [])
      }
      setInsightsOpen(true)
    } catch (e: any) {
      setInsights([{
        type: 'engagement_alert', title: 'Connection Error',
        description: e.message || 'Failed to reach the AI analysis endpoint.',
        contact_ids: [], confidence: 0, priority: 'low'
      }])
      setInsightsOpen(true)
    }
    setInsightsLoading(false)
  }

  const handleAddRelationship = async () => {
    if (!addRelFrom || !addRelTo || !addRelType || !currentOrg) return
    try {
      await createRelationship({
        org_id: currentOrg.id, from_contact_id: addRelFrom,
        to_contact_id: addRelTo, relationship_type: addRelType,
        notes: addRelNotes, strength: addRelStrength, created_by: user?.id,
      })
      setAddRelOpen(false)
      setAddRelFrom(''); setAddRelTo(''); setAddRelType(''); setAddRelNotes(''); setAddRelStrength(3)
      loadData()
    } catch (err: any) {
      alert(err.message || 'Failed to create relationship')
    }
  }

  const handleDeleteEdge = async (edgeId: string) => {
    if (!confirm('Remove this connection?')) return
    try {
      await deleteRelationship(edgeId)
      setEditingEdge(null)
      loadData()
    } catch (err: any) { alert(err.message || 'Failed to delete') }
  }

  const handleUpdateEdgeStrength = async (edgeId: string, strength: number) => {
    try {
      await updateRelationship(edgeId, { strength })
      loadData()
    } catch (err: any) { alert(err.message || 'Failed to update') }
  }

  const toggleTagFilter = (name: string) => {
    setActiveTagFilters(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  const toggleCat = (catId: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  // ── BFS Pathfinder: find shortest connection chain ──
  const findPath = useCallback((fromId: string, toId: string): string[] => {
    if (!graphData || fromId === toId) return []
    const adj = new Map<string, string[]>()
    graphData.edges.forEach(e => {
      if (!adj.has(e.from)) adj.set(e.from, [])
      if (!adj.has(e.to)) adj.set(e.to, [])
      adj.get(e.from)!.push(e.to)
      adj.get(e.to)!.push(e.from)
    })
    const visited = new Set<string>()
    const parent = new Map<string, string>()
    const queue = [fromId]
    visited.add(fromId)
    while (queue.length > 0) {
      const current = queue.shift()!
      if (current === toId) {
        const path: string[] = []
        let node = toId
        while (node) { path.unshift(node); node = parent.get(node)! }
        return path
      }
      for (const neighbor of (adj.get(current) || [])) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor)
          parent.set(neighbor, current)
          queue.push(neighbor)
        }
      }
    }
    return [] // no path found
  }, [graphData])

  useEffect(() => {
    if (pathFrom && pathTo) {
      setPathResult(findPath(pathFrom, pathTo))
    } else {
      setPathResult([])
    }
  }, [pathFrom, pathTo, findPath])

  // ═══════════════════════════════════════════════════════════════
  // DERIVED DATA
  // ═══════════════════════════════════════════════════════════════
  const selectedNodeData = simNodes.find(n => n.id === selectedNode)
  const selectedEdges = graphData?.edges.filter(
    e => e.from === selectedNode || e.to === selectedNode
  ) || []

  // ── Loading ──
  if (orgLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <div className="text-center">
        <Loader2 className="w-8 h-8 text-np-blue animate-spin mx-auto mb-3" />
        <p className="text-xs text-gray-400">Loading network graph...</p>
      </div>
    </div>
  )

  // ═══════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════
  return (
    <div className="h-[calc(100vh-10rem)] flex gap-3">

      {/* ═══ LEFT SIDEBAR ═══ */}
      <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
        {/* Search + View Toggle + Controls */}
        <div className="px-3 py-2.5 border-b border-gray-100 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-300" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search contacts..."
              className="w-full pl-8 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[9px] text-gray-400 font-medium">
              {visibleNodes.length} of {simNodes.length} contacts
            </span>
            <div className="flex gap-1">
              <button onClick={() => setViewMode('graph')}
                className={`p-1 rounded ${viewMode === 'graph' ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600'}`}
                title="Graph view">
                <LayoutGrid className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setViewMode('list')}
                className={`p-1 rounded ${viewMode === 'list' ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600'}`}
                title="List view">
                <List className="w-3.5 h-3.5" />
              </button>
              <div className="w-px bg-gray-200 mx-0.5" />
              <button onClick={() => setShowOrphans(!showOrphans)}
                className={`p-1 rounded ${!showOrphans ? 'bg-np-blue/10 text-np-blue' : 'text-gray-400 hover:text-gray-600'}`}
                title={showOrphans ? 'Hide orphans' : 'Show orphans'}>
                {showOrphans ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => { setEventMode(!eventMode); setEventContacts(new Set()) }}
                className={`p-1 rounded ${eventMode ? 'bg-amber-50 text-amber-600' : 'text-gray-400 hover:text-gray-600'}`}
                title="Event planner">
                <Calendar className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Event Mode Banner */}
        {eventMode && (
          <div className="px-3 py-2 bg-amber-50 border-b border-amber-100">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold text-amber-700">Event Planner Mode</p>
                <p className="text-[9px] text-amber-600">
                  {eventContacts.size} selected{bridgeContacts.length > 0 && `, ${bridgeContacts.length} bridge(s)`}
                </p>
              </div>
              {eventContacts.size > 0 && (
                <button onClick={() => setEventContacts(new Set())}
                  className="text-[8px] text-amber-700 bg-amber-100 px-2 py-0.5 rounded font-medium hover:bg-amber-200 transition-colors">
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Tag Category Filters */}
        {tagCategories.length > 0 && (
          <div className="border-b border-gray-100 max-h-44 overflow-y-auto">
            <div className="px-3 py-1.5 flex items-center justify-between sticky top-0 bg-white z-10">
              <span className="text-[8px] font-bold text-gray-400 uppercase tracking-wider">Tag Filters</span>
              {activeTagFilters.size > 0 && (
                <button onClick={() => setActiveTagFilters(new Set())}
                  className="text-[8px] text-red-400 hover:text-red-600 font-medium">
                  Clear ({activeTagFilters.size})
                </button>
              )}
            </div>
            {tagCategories.map(cat => (
              <div key={cat.id} className="px-3">
                <button onClick={() => toggleCat(cat.id)}
                  className="flex items-center gap-1.5 w-full py-1 text-left group">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                  <span className="text-[9px] font-semibold flex-1" style={{ color: cat.color }}>
                    {cat.name}
                  </span>
                  <ChevronDown className={`w-3 h-3 text-gray-400 transition-transform ${expandedCats.has(cat.id) ? 'rotate-180' : ''}`} />
                </button>
                {expandedCats.has(cat.id) && (
                  <div className="flex flex-wrap gap-1 pb-2 pl-3.5">
                    {(cat.tags || []).map(tag => (
                      <button key={tag.id} onClick={() => toggleTagFilter(tag.name)}
                        className={`text-[7px] px-1.5 py-0.5 rounded-full border transition-all ${
                          activeTagFilters.has(tag.name)
                            ? 'text-white border-transparent shadow-sm'
                            : 'text-gray-500 border-gray-200 hover:border-gray-300'
                        }`}
                        style={activeTagFilters.has(tag.name) ? { backgroundColor: cat.color } : {}}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Contact List */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-1.5 space-y-1">
            {visibleNodes.map(node => {
              const isSelected = selectedNode === node.id
              const isEventTarget = eventContacts.has(node.id)
              const isBridge = bridgeContacts.includes(node.id)
              const clusterColor = node.cluster_id !== undefined
                ? CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length]
                : '#94a3b8'

              return (
                <button key={node.id}
                  onClick={() => {
                    if (eventMode) {
                      setEventContacts(prev => {
                        const n = new Set(prev)
                        n.has(node.id) ? n.delete(node.id) : n.add(node.id)
                        return n
                      })
                    } else {
                      setSelectedNode(isSelected ? null : node.id)
                    }
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-xl transition-all border ${
                    isSelected ? 'bg-np-blue/5 border-np-blue/20 shadow-sm' :
                    isEventTarget ? 'bg-green-50 border-green-200' :
                    isBridge ? 'bg-amber-50 border-amber-200' :
                    'hover:bg-gray-50 border-transparent'
                  }`}>
                  <div className="flex items-center gap-2.5">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[9px] font-bold flex-shrink-0"
                      style={{ backgroundColor: clusterColor }}>
                      {node.avatar}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-np-dark truncate">{node.name}</p>
                      <p className="text-[8px] text-gray-400 truncate">
                        {node.pipeline_stage || 'No stage'}
                        {node.relationship_count > 0 && ` \u00B7 ${node.relationship_count} conn.`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {node.interaction_score > 0 && (
                        <span className="text-[8px] font-bold text-np-blue bg-np-blue/10 px-1.5 py-0.5 rounded-full">
                          {Math.round(node.interaction_score)}
                        </span>
                      )}
                      {eventMode && (
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                          isEventTarget ? 'bg-green-500 border-green-500 text-white' :
                          isBridge ? 'bg-amber-400 border-amber-400 text-white' :
                          'border-gray-300'
                        }`}>
                          {(isEventTarget || isBridge) && <span className="text-[7px] font-bold">\u2713</span>}
                        </div>
                      )}
                    </div>
                  </div>
                  {node.tags.length > 0 && (
                    <div className="flex flex-wrap gap-0.5 mt-1.5 pl-9">
                      {node.tags.slice(0, 3).map(t => (
                        <TagPill key={t} name={t} color={tagColorMap.get(t)} small />
                      ))}
                      {node.tags.length > 3 && (
                        <span className="text-[7px] text-gray-400">+{node.tags.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
            {visibleNodes.length === 0 && (
              <div className="text-center py-8">
                <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                <p className="text-[10px] text-gray-400">No contacts match filters</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ CENTER: GRAPH / LIST ═══ */}
      <div className="flex-1 bg-white border border-gray-100 rounded-2xl overflow-hidden relative min-w-0 flex flex-col">
        {viewMode === 'graph' ? (
          <>
            {/* Toolbar top-left */}
            <div className="absolute top-3 left-3 z-10 flex gap-1.5">
              <button onClick={() => setAddRelOpen(true)}
                className="flex items-center gap-1 text-[10px] font-bold text-white bg-np-blue px-2.5 py-1.5 rounded-lg shadow-sm hover:bg-np-blue/90 transition-colors">
                <Plus className="w-3 h-3" /> Connection
              </button>
              <button onClick={() => { setPathMode(!pathMode); setPathFrom(null); setPathTo(null); setPathResult([]) }}
                className={`flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-lg shadow-sm transition-colors ${pathMode ? 'bg-amber-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:text-np-blue'}`}>
                <Link className="w-3 h-3" /> Find Path
              </button>
              <button onClick={loadData}
                className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-500 hover:text-np-blue transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }}
                className="p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-500 hover:text-np-blue transition-colors">
                <Crosshair className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Zoom controls bottom-right */}
            <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
              <button onClick={() => setZoom(z => Math.min(3, z * 1.25))}
                className="w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center justify-center text-gray-500 hover:text-np-blue transition-colors">
                <ZoomIn className="w-4 h-4" />
              </button>
              <div className="text-center text-[8px] text-gray-400 font-medium">{Math.round(zoom * 100)}%</div>
              <button onClick={() => setZoom(z => Math.max(0.2, z * 0.8))}
                className="w-8 h-8 bg-white border border-gray-200 rounded-lg shadow-sm flex items-center justify-center text-gray-500 hover:text-np-blue transition-colors">
                <ZoomOut className="w-4 h-4" />
              </button>
            </div>

            {/* Pathfinder banner */}
            {pathMode && (
              <div className="absolute top-14 left-3 z-10 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 shadow-sm max-w-xs">
                <p className="text-[10px] font-bold text-amber-700 mb-1">Connection Chain Finder</p>
                <p className="text-[9px] text-amber-600 mb-2">Click two contacts to find the shortest path between them.</p>
                <div className="space-y-1">
                  <p className="text-[9px] text-amber-700">From: <span className="font-bold">{pathFrom ? simNodes.find(n => n.id === pathFrom)?.name || '...' : 'Click a contact'}</span></p>
                  <p className="text-[9px] text-amber-700">To: <span className="font-bold">{pathTo ? simNodes.find(n => n.id === pathTo)?.name || '...' : 'Click another contact'}</span></p>
                </div>
                {pathResult.length > 0 && (
                  <div className="mt-2 pt-2 border-t border-amber-200">
                    <p className="text-[9px] font-bold text-green-700 mb-1">{pathResult.length - 1} degrees of separation:</p>
                    <div className="flex items-center gap-1 flex-wrap">
                      {pathResult.map((id, i) => {
                        const node = simNodes.find(n => n.id === id)
                        return node ? (
                          <span key={id} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="w-3 h-3 text-amber-400" />}
                            <span className="text-[9px] font-semibold text-np-dark bg-white px-1.5 py-0.5 rounded border border-amber-200">{node.name.split(' ')[0]}</span>
                          </span>
                        ) : null
                      })}
                    </div>
                  </div>
                )}
                {pathFrom && pathTo && pathResult.length === 0 && (
                  <p className="mt-2 text-[9px] text-red-600 font-medium">No connection path found between these contacts.</p>
                )}
              </div>
            )}

            {/* Stats + AI top-right */}
            <div className="absolute top-3 right-3 z-10 flex gap-2">
              <div className="bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-2.5 py-1.5 text-[9px] text-gray-500 font-medium">
                {graphData?.nodes.length || 0} nodes &middot; {graphData?.edges.length || 0} edges &middot; {graphData?.clusters.length || 0} clusters
              </div>
              <button onClick={generateInsights} disabled={insightsLoading}
                className="flex items-center gap-1 text-[10px] font-bold bg-purple-600 text-white px-2.5 py-1.5 rounded-lg shadow-sm hover:bg-purple-700 disabled:opacity-50 transition-colors">
                {insightsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                AI Insights
              </button>
            </div>

            {/* Canvas */}
            <div ref={containerRef} className="flex-1">
              <canvas
                ref={canvasRef}
                style={{ width: canvasSize.w, height: canvasSize.h }}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onClick={handleCanvasClick}
                onWheel={handleWheel}
              />
            </div>

            {/* Legend bottom-left */}
            <div className="absolute bottom-3 left-3 z-10 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Clusters</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                {(graphData?.clusters || []).map(c => (
                  <div key={c.id} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CLUSTER_COLORS[c.id % CLUSTER_COLORS.length] }} />
                    <span className="text-[8px] text-gray-500">{c.dominant_tags[0] || `Cluster ${c.id}`} ({c.contact_ids.length})</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-1 text-[7px] text-gray-400">
                <span>Drag to move</span>
                <span>Scroll to zoom</span>
                <span>Click to select</span>
              </div>
            </div>
          </>
        ) : (
          /* ═══ LIST VIEW ═══ */
          <div className="flex-1 overflow-auto">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 sticky top-0 bg-white z-10">
              <span className="text-xs font-bold text-np-dark">{visibleNodes.length} Contacts</span>
              <div className="flex gap-2">
                <button onClick={generateInsights} disabled={insightsLoading}
                  className="flex items-center gap-1 text-[10px] font-bold bg-purple-600 text-white px-2.5 py-1.5 rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
                  {insightsLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  AI Insights
                </button>
                <button onClick={() => setAddRelOpen(true)}
                  className="flex items-center gap-1 text-[10px] font-bold text-white bg-np-blue px-2.5 py-1.5 rounded-lg hover:bg-np-blue/90 transition-colors">
                  <Plus className="w-3 h-3" /> Connection
                </button>
              </div>
            </div>
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Name', 'Stage', 'Tags', 'Connections', 'Score'].map(h => (
                    <th key={h} className="text-left px-4 py-2 text-[9px] font-bold text-gray-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleNodes.map(node => (
                  <tr key={node.id}
                    onClick={() => setSelectedNode(selectedNode === node.id ? null : node.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${
                      selectedNode === node.id ? 'bg-np-blue/5' : 'hover:bg-gray-50'
                    }`}>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                          style={{ backgroundColor: node.cluster_id !== undefined ? CLUSTER_COLORS[node.cluster_id % CLUSTER_COLORS.length] : '#94a3b8' }}>
                          {node.avatar}
                        </div>
                        <span className="font-semibold text-np-dark">{node.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{node.pipeline_stage || '-'}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-0.5">
                        {node.tags.slice(0, 3).map(t => (
                          <TagPill key={t} name={t} color={tagColorMap.get(t)} small />
                        ))}
                        {node.tags.length > 3 && <span className="text-[7px] text-gray-400">+{node.tags.length - 3}</span>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-np-blue font-bold">{node.relationship_count}</td>
                    <td className="px-4 py-2.5">
                      <span className="text-[9px] font-bold text-np-blue bg-np-blue/10 px-2 py-0.5 rounded-full">
                        {Math.round(node.interaction_score)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ RIGHT: DETAIL PANEL ═══ */}
      {selectedNodeData && (
        <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm"
                  style={{ backgroundColor: selectedNodeData.cluster_id !== undefined ? CLUSTER_COLORS[selectedNodeData.cluster_id % CLUSTER_COLORS.length] : '#94a3b8' }}>
                  {selectedNodeData.avatar}
                </div>
                <div>
                  <h3 className="text-sm font-bold text-np-dark">{selectedNodeData.name}</h3>
                  <p className="text-[9px] text-gray-400">
                    {selectedNodeData.preferred_name ? `"${selectedNodeData.preferred_name}" · ` : ''}
                    {selectedNodeData.pipeline_stage || 'No stage'}
                  </p>
                </div>
              </div>
              <button onClick={() => setSelectedNode(null)} className="text-gray-400 hover:text-gray-600 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Expandable Contact Info */}
            <button onClick={() => setShowContactInfo(!showContactInfo)}
              className="flex items-center gap-1 mt-2 text-[9px] text-np-blue font-medium w-full">
              <ChevronDown className={`w-3 h-3 transition-transform ${showContactInfo ? 'rotate-180' : ''}`} />
              Contact Info
            </button>
            {showContactInfo && (
              <div className="mt-1.5 space-y-1.5 pl-1">
                {selectedNodeData.phone && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <Phone className="w-3 h-3 text-green-500" />
                    <span className="text-np-dark">{selectedNodeData.phone}</span>
                  </div>
                )}
                {selectedNodeData.email && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <Mail className="w-3 h-3 text-amber-500" />
                    <span className="text-np-dark truncate">{selectedNodeData.email}</span>
                  </div>
                )}
                {(selectedNodeData.address_city || selectedNodeData.address_state) && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <MapPin className="w-3 h-3 text-blue-500" />
                    <span className="text-np-dark">{[selectedNodeData.address_city, selectedNodeData.address_state].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {selectedNodeData.occupation && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <Users className="w-3 h-3 text-gray-400" />
                    <span className="text-np-dark">{selectedNodeData.occupation}</span>
                  </div>
                )}
                {selectedNodeData.reason_for_contact && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <Target className="w-3 h-3 text-purple-500" />
                    <span className="text-np-dark">{selectedNodeData.reason_for_contact}</span>
                  </div>
                )}
                {(selectedNodeData.instagram_handle || selectedNodeData.linkedin_url) && (
                  <div className="flex items-center gap-2 text-[10px]">
                    <ExternalLink className="w-3 h-3 text-indigo-500" />
                    {selectedNodeData.instagram_handle && <span className="text-np-dark">@{selectedNodeData.instagram_handle.replace('@','')}</span>}
                    {selectedNodeData.linkedin_url && <a href={selectedNodeData.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-np-blue hover:underline">LinkedIn</a>}
                  </div>
                )}
                {!selectedNodeData.phone && !selectedNodeData.email && (
                  <p className="text-[9px] text-gray-400 italic">No contact details on file</p>
                )}
              </div>
            )}
          </div>

          {/* Scores */}
          <div className="px-4 py-3 border-b border-gray-100 grid grid-cols-3 gap-2">
            {[
              { label: 'Connections', value: selectedNodeData.relationship_count },
              { label: 'Score', value: Math.round(selectedNodeData.interaction_score) },
              { label: 'Centrality', value: (selectedNodeData.network_centrality * 100).toFixed(1) + '%' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-sm font-bold text-np-dark">{s.value}</p>
                <p className="text-[8px] text-gray-400">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Tags */}
          {selectedNodeData.tags.length > 0 && (
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Tags</p>
              <div className="flex flex-wrap gap-1">
                {selectedNodeData.tags.map(tag => (
                  <TagPill key={tag} name={tag} color={tagColorMap.get(tag)} />
                ))}
              </div>
            </div>
          )}

          {/* Connections List */}
          <div className="flex-1 overflow-y-auto px-4 py-2.5">
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-2">
              {selectedEdges.length} Connections
            </p>
            <div className="space-y-1.5">
              {selectedEdges.map(edge => {
                const otherId = edge.from === selectedNode ? edge.to : edge.from
                const other = simNodes.find(n => n.id === otherId)
                if (!other) return null
                const otherColor = other.cluster_id !== undefined
                  ? CLUSTER_COLORS[other.cluster_id % CLUSTER_COLORS.length]
                  : '#94a3b8'
                const isEditing = editingEdge === edge.id
                return (
                  <div key={edge.id} className="rounded-lg border border-transparent hover:border-gray-100 transition-colors">
                    <div className="flex items-center gap-2 px-2 py-1.5 cursor-pointer"
                      onClick={() => setSelectedNode(otherId)}>
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[8px] font-bold flex-shrink-0"
                        style={{ backgroundColor: otherColor }}>
                        {other.avatar}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-semibold text-np-dark truncate">{other.name}</p>
                        <p className="text-[8px] truncate" style={{ color: edge.color || '#6366f1' }}>{edge.label}</p>
                      </div>
                      <div className="flex gap-0.5 flex-shrink-0">
                        {[1, 2, 3, 4, 5].map(s => (
                          <div key={s} className={`w-1 h-1 rounded-full ${s <= edge.strength ? 'bg-np-blue' : 'bg-gray-200'}`} />
                        ))}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setEditingEdge(isEditing ? null : edge.id); setEditStrength(edge.strength) }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-gray-300 hover:text-gray-500 transition-all"
                        style={{ opacity: isEditing ? 1 : undefined }}>
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                    {isEditing && (
                      <div className="px-2 pb-2 pt-1 border-t border-gray-50 space-y-2" onClick={e => e.stopPropagation()}>
                        <div>
                          <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Strength</p>
                          <div className="flex gap-1">
                            {[1, 2, 3, 4, 5].map(s => (
                              <button key={s} onClick={() => { setEditStrength(s); handleUpdateEdgeStrength(edge.id, s) }}
                                className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${
                                  s <= editStrength ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-400'
                                }`}>
                                {s}
                              </button>
                            ))}
                          </div>
                        </div>
                        <button onClick={() => handleDeleteEdge(edge.id)}
                          className="flex items-center gap-1 text-[9px] text-red-500 hover:text-red-700 font-medium transition-colors">
                          <Trash2 className="w-3 h-3" /> Remove Connection
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
              {selectedEdges.length === 0 && (
                <p className="text-[9px] text-gray-400 text-center py-3">No connections yet</p>
              )}
            </div>
          </div>

          {/* Quick actions */}
          <div className="px-4 py-2.5 border-t border-gray-100 space-y-1.5">
            <button onClick={() => { setAddRelFrom(selectedNode || ''); setAddRelOpen(true) }}
              className="w-full flex items-center justify-center gap-1 text-[10px] font-medium text-np-blue border border-np-blue/20 rounded-lg py-1.5 hover:bg-np-blue/5 transition-colors">
              <Plus className="w-3 h-3" /> Add Connection
            </button>
            <button onClick={() => { setPathMode(true); setPathFrom(selectedNode); setPathTo(null); setPathResult([]) }}
              className="w-full flex items-center justify-center gap-1 text-[10px] font-medium text-amber-600 border border-amber-200 rounded-lg py-1.5 hover:bg-amber-50 transition-colors">
              <Link className="w-3 h-3" /> Find Path From Here
            </button>
          </div>
        </div>
      )}

      {/* ═══ AI INSIGHTS PANEL ═══ */}
      {insightsOpen && (
        <div className="fixed bottom-0 right-0 w-96 max-h-[60vh] bg-white border border-gray-200 rounded-t-2xl shadow-2xl z-40 flex flex-col">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-purple-500" />
              <h3 className="text-sm font-bold text-np-dark">Network Insights</h3>
              <span className="text-[9px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">{insights.length}</span>
            </div>
            <button onClick={() => setInsightsOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {insights.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">No insights yet. Click &quot;AI Insights&quot; to analyze.</p>
            ) : insights.map((insight, i) => {
              const Icon = INSIGHT_ICONS[insight.type] || Sparkles
              return (
                <div key={i} className={`border rounded-xl p-3 ${
                  insight.priority === 'high' ? 'border-red-200 bg-red-50/30' :
                  insight.priority === 'medium' ? 'border-amber-200 bg-amber-50/30' :
                  'border-gray-200'
                }`}>
                  <div className="flex items-start gap-2">
                    <Icon className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
                      insight.priority === 'high' ? 'text-red-500' :
                      insight.priority === 'medium' ? 'text-amber-500' : 'text-gray-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-bold text-np-dark">{insight.title}</p>
                      <p className="text-[10px] text-gray-600 mt-0.5 leading-relaxed">{insight.description}</p>
                      {insight.action && (
                        <p className="text-[9px] text-purple-600 font-medium mt-1">Action: {insight.action}</p>
                      )}
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[8px] text-gray-400">{(insight.confidence * 100).toFixed(0)}% confidence</span>
                        {insight.contact_ids.length > 0 && (
                          <button onClick={() => {
                            setSelectedNode(insight.contact_ids[0])
                            setInsightsOpen(false)
                          }} className="text-[8px] text-np-blue font-medium hover:underline">
                            View ({insight.contact_ids.length})
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ═══ ADD RELATIONSHIP MODAL ═══ */}
      {addRelOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setAddRelOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-np-dark">Add Connection</h3>
              <button onClick={() => setAddRelOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">From</label>
                <select value={addRelFrom} onChange={e => setAddRelFrom(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">Select contact...</option>
                  {simNodes.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Relationship</label>
                <select value={addRelType} onChange={e => setAddRelType(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">Select type...</option>
                  {relTypes.map(t => <option key={t.id} value={t.name}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">To</label>
                <select value={addRelTo} onChange={e => setAddRelTo(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                  <option value="">Select contact...</option>
                  {simNodes.filter(n => n.id !== addRelFrom).map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Strength</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(s => (
                    <button key={s} onClick={() => setAddRelStrength(s)}
                      className={`w-8 h-8 rounded-lg text-xs font-bold transition-colors ${
                        s <= addRelStrength ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-400'
                      }`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-gray-400 uppercase block mb-1">Notes</label>
                <input value={addRelNotes} onChange={e => setAddRelNotes(e.target.value)}
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300"
                  placeholder="How they know each other..." />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
              <button onClick={() => setAddRelOpen(false)}
                className="text-xs text-gray-500 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
              <button onClick={handleAddRelationship}
                disabled={!addRelFrom || !addRelTo || !addRelType}
                className="text-xs font-bold text-white bg-np-blue px-4 py-2 rounded-lg disabled:opacity-40 hover:bg-np-blue/90 transition-colors">
                Create Connection
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
