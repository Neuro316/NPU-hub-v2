'use client'

import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ════════════════════════════════════════════════
// Types
// ════════════════════════════════════════════════
interface PresenceUser {
  user_id: string
  user_name: string
  user_email: string
  avatar_color: string
  current_page: string
  current_resource?: { type: string; id: string; name: string }
  online_at: string
  last_seen: string
}

interface ResourceLock {
  id: string
  resource_type: string
  resource_id: string
  locked_by: string
  locked_by_name: string
  locked_by_email: string
  lock_mode: 'exclusive' | 'collaborative'
  collaborators: Array<{ user_id: string; user_name: string; joined_at: string }>
  locked_at: string
  expires_at: string
}

interface FieldUpdate {
  user_id: string
  user_name: string
  field: string
  value: any
  timestamp: string
}

interface AuditEntry {
  action: string
  resource_type: string
  resource_id?: string
  resource_name?: string
  details?: Record<string, any>
  page_path?: string
}

interface CollaborationContextType {
  // Presence
  onlineUsers: PresenceUser[]
  myPresence: PresenceUser | null
  setCurrentPage: (page: string) => void
  setCurrentResource: (resource: { type: string; id: string; name: string } | undefined) => void
  getUsersOnPage: (page: string) => PresenceUser[]
  getUsersOnResource: (type: string, id: string) => PresenceUser[]

  // Resource Locking
  acquireLock: (resourceType: string, resourceId: string, resourceName: string) => Promise<{ granted: boolean; lock?: ResourceLock; conflict?: ResourceLock }>
  releaseLock: (resourceType: string, resourceId: string) => Promise<void>
  joinCollaboration: (resourceType: string, resourceId: string) => Promise<void>
  getLock: (resourceType: string, resourceId: string) => ResourceLock | null
  activeLocks: ResourceLock[]

  // Real-time Field Sync
  broadcastFieldUpdate: (resourceType: string, resourceId: string, field: string, value: any) => void
  onFieldUpdate: (resourceType: string, resourceId: string, callback: (update: FieldUpdate) => void) => () => void

  // Audit Logging
  logAction: (entry: AuditEntry) => Promise<void>
  logFieldChange: (resourceType: string, resourceId: string, field: string, oldValue: any, newValue: any) => Promise<void>

  // Session
  sessionId: string
}

const CollaborationContext = createContext<CollaborationContextType | null>(null)

// Generate consistent avatar color from user_id
function avatarColor(id: string): string {
  const colors = ['#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316']
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

// Generate session ID
function generateSessionId(): string {
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ════════════════════════════════════════════════
// Provider
// ════════════════════════════════════════════════
export function CollaborationProvider({ children }: { children: ReactNode }) {
  const supabase = createClient()
  const { user, currentOrg } = useWorkspace()

  const [onlineUsers, setOnlineUsers] = useState<PresenceUser[]>([])
  const [myPresence, setMyPresence] = useState<PresenceUser | null>(null)
  const [activeLocks, setActiveLocks] = useState<ResourceLock[]>([])
  const [sessionId] = useState(() => generateSessionId())

  const presenceChannelRef = useRef<RealtimeChannel | null>(null)
  const resourceChannelsRef = useRef<Map<string, RealtimeChannel>>(new Map())
  const currentPageRef = useRef<string>('')
  const currentResourceRef = useRef<{ type: string; id: string; name: string } | undefined>()
  const heartbeatRef = useRef<NodeJS.Timeout | null>(null)

  // ── Initialize Presence Channel ──
  useEffect(() => {
    if (!user || !currentOrg) return

    const me: PresenceUser = {
      user_id: user.id,
      user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
      user_email: user.email || '',
      avatar_color: avatarColor(user.id),
      current_page: currentPageRef.current || '/',
      current_resource: currentResourceRef.current,
      online_at: new Date().toISOString(),
      last_seen: new Date().toISOString(),
    }
    setMyPresence(me)

    const channel = supabase.channel(`presence:${currentOrg.id}`, {
      config: { presence: { key: user.id } },
    })

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState()
        const users: PresenceUser[] = []
        Object.values(state).forEach((arr: any[]) => {
          arr.forEach((p: any) => {
            if (p.user_id !== user.id) {
              users.push(p as PresenceUser)
            }
          })
        })
        setOnlineUsers(users)
      })
      .on('presence', { event: 'join' }, ({ newPresences }: any) => {
        // Someone came online
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }: any) => {
        // Someone went offline - clean up their locks
        leftPresences?.forEach((p: any) => {
          if (p.user_id) {
            cleanupUserLocks(p.user_id)
          }
        })
      })
      .subscribe(async (status: string) => {
        if (status === 'SUBSCRIBED') {
          await channel.track(me)
        }
      })

    presenceChannelRef.current = channel

    // Log login
    logActionInternal({
      action: 'login',
      resource_type: 'session',
      resource_id: sessionId,
      details: { user_agent: navigator.userAgent },
    })

    // Heartbeat: update presence + extend locks every 25 seconds
    heartbeatRef.current = setInterval(async () => {
      const updated = {
        ...me,
        current_page: currentPageRef.current,
        current_resource: currentResourceRef.current,
        last_seen: new Date().toISOString(),
      }
      await channel.track(updated)

      // Extend any locks we hold
      try {
        await supabase.rpc('extend_lock', {
          p_org_id: currentOrg.id,
          p_resource_type: '*',
          p_resource_id: '*',
          p_user_id: user.id,
        })
      } catch {}

    }, 25000)

    // Fetch existing locks
    fetchLocks()

    // Subscribe to lock changes
    const lockChannel = supabase.channel(`locks:${currentOrg.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'resource_locks', filter: `org_id=eq.${currentOrg.id}` }, () => {
        fetchLocks()
      })
      .subscribe()

    return () => {
      channel.unsubscribe()
      lockChannel.unsubscribe()
      if (heartbeatRef.current) clearInterval(heartbeatRef.current)
      presenceChannelRef.current = null

      // Release all our locks on unmount
      supabase.from('resource_locks').delete().eq('locked_by', user.id).eq('org_id', currentOrg.id)

      // Log logout
      logActionInternal({ action: 'logout', resource_type: 'session', resource_id: sessionId })
    }
  }, [user?.id, currentOrg?.id])

  // ── Fetch Locks ──
  const fetchLocks = useCallback(async () => {
    if (!currentOrg) return
    // Clean expired first
    try { await supabase.rpc('cleanup_expired_locks') } catch {}
    const { data } = await supabase.from('resource_locks').select('*').eq('org_id', currentOrg.id)
    if (data) setActiveLocks(data)
  }, [currentOrg?.id])

  // ── Clean up locks for disconnected user ──
  const cleanupUserLocks = async (userId: string) => {
    if (!currentOrg) return
    await supabase.from('resource_locks').delete().eq('locked_by', userId).eq('org_id', currentOrg.id)
    fetchLocks()
  }

  // ── Internal audit log ──
  const logActionInternal = async (entry: AuditEntry) => {
    if (!user || !currentOrg) return
    try {
      await supabase.from('audit_log').insert({
        org_id: currentOrg.id,
        user_id: user.id,
        user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
        user_email: user.email,
        session_id: sessionId,
        page_path: currentPageRef.current,
        ...entry,
      })
    } catch {} // Never block on audit log failures
  }

  // ════════════════════════════════════════════════
  // Public API
  // ════════════════════════════════════════════════

  const setCurrentPage = useCallback((page: string) => {
    currentPageRef.current = page
    // Update presence
    if (presenceChannelRef.current && myPresence) {
      presenceChannelRef.current.track({ ...myPresence, current_page: page, last_seen: new Date().toISOString() })
    }
  }, [myPresence])

  const setCurrentResource = useCallback((resource: { type: string; id: string; name: string } | undefined) => {
    currentResourceRef.current = resource
    if (presenceChannelRef.current && myPresence) {
      presenceChannelRef.current.track({ ...myPresence, current_resource: resource, last_seen: new Date().toISOString() })
    }
  }, [myPresence])

  const getUsersOnPage = useCallback((page: string) => {
    return onlineUsers.filter(u => u.current_page === page)
  }, [onlineUsers])

  const getUsersOnResource = useCallback((type: string, id: string) => {
    return onlineUsers.filter(u => u.current_resource?.type === type && u.current_resource?.id === id)
  }, [onlineUsers])

  // ── Resource Locking ──
  const acquireLock = useCallback(async (resourceType: string, resourceId: string, resourceName: string) => {
    if (!user || !currentOrg) return { granted: false }

    // Check for existing lock
    const { data: existing } = await supabase
      .from('resource_locks')
      .select('*')
      .eq('org_id', currentOrg.id)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .single()

    if (existing && existing.locked_by !== user.id && new Date(existing.expires_at) > new Date()) {
      // Someone else has it locked
      return { granted: false, conflict: existing as ResourceLock }
    }

    // If expired or ours, upsert
    const lockData = {
      org_id: currentOrg.id,
      resource_type: resourceType,
      resource_id: resourceId,
      locked_by: user.id,
      locked_by_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
      locked_by_email: user.email || '',
      lock_mode: 'exclusive' as const,
      collaborators: [],
      locked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
      heartbeat_at: new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('resource_locks')
      .upsert(lockData, { onConflict: 'org_id,resource_type,resource_id' })
      .select()
      .single()

    if (error) return { granted: false }

    logActionInternal({
      action: 'lock',
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
    })

    fetchLocks()
    return { granted: true, lock: data as ResourceLock }
  }, [user?.id, currentOrg?.id])

  const releaseLock = useCallback(async (resourceType: string, resourceId: string) => {
    if (!user || !currentOrg) return

    await supabase
      .from('resource_locks')
      .delete()
      .eq('org_id', currentOrg.id)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .eq('locked_by', user.id)

    logActionInternal({
      action: 'unlock',
      resource_type: resourceType,
      resource_id: resourceId,
    })

    fetchLocks()
  }, [user?.id, currentOrg?.id])

  const joinCollaboration = useCallback(async (resourceType: string, resourceId: string) => {
    if (!user || !currentOrg) return

    const { data: lock } = await supabase
      .from('resource_locks')
      .select('*')
      .eq('org_id', currentOrg.id)
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .single()

    if (!lock) return

    const collaborators = [...(lock.collaborators || []), {
      user_id: user.id,
      user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
      joined_at: new Date().toISOString(),
    }]

    await supabase
      .from('resource_locks')
      .update({ lock_mode: 'collaborative', collaborators })
      .eq('id', lock.id)

    logActionInternal({
      action: 'collaborate',
      resource_type: resourceType,
      resource_id: resourceId,
    })

    fetchLocks()
  }, [user?.id, currentOrg?.id])

  const getLock = useCallback((resourceType: string, resourceId: string): ResourceLock | null => {
    return activeLocks.find(l => l.resource_type === resourceType && l.resource_id === resourceId) || null
  }, [activeLocks])

  // ── Real-time Field Sync ──
  const broadcastFieldUpdate = useCallback((resourceType: string, resourceId: string, field: string, value: any) => {
    if (!user || !currentOrg) return
    const channelKey = `collab:${currentOrg.id}:${resourceType}:${resourceId}`
    let channel = resourceChannelsRef.current.get(channelKey)

    if (!channel) {
      channel = supabase.channel(channelKey)
      channel.subscribe()
      resourceChannelsRef.current.set(channelKey, channel)
    }

    channel.send({
      type: 'broadcast',
      event: 'field_update',
      payload: {
        user_id: user.id,
        user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
        field,
        value,
        timestamp: new Date().toISOString(),
      },
    })
  }, [user?.id, currentOrg?.id])

  const onFieldUpdate = useCallback((resourceType: string, resourceId: string, callback: (update: FieldUpdate) => void) => {
    if (!currentOrg) return () => {}
    const channelKey = `collab:${currentOrg.id}:${resourceType}:${resourceId}`
    let channel = resourceChannelsRef.current.get(channelKey)

    if (!channel) {
      channel = supabase.channel(channelKey)
      resourceChannelsRef.current.set(channelKey, channel)
    }

    channel
      .on('broadcast', { event: 'field_update' }, (msg: any) => {
        if (msg.payload.user_id !== user?.id) {
          callback(msg.payload as FieldUpdate)
        }
      })
      .subscribe()

    return () => {
      channel?.unsubscribe()
      resourceChannelsRef.current.delete(channelKey)
    }
  }, [user?.id, currentOrg?.id])

  // ── Audit Logging ──
  const logAction = useCallback(async (entry: AuditEntry) => {
    await logActionInternal(entry)
  }, [user?.id, currentOrg?.id, sessionId])

  const logFieldChange = useCallback(async (resourceType: string, resourceId: string, field: string, oldValue: any, newValue: any) => {
    if (!user || !currentOrg) return
    try {
      await supabase.from('change_history').insert({
        org_id: currentOrg.id,
        user_id: user.id,
        user_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Unknown',
        resource_type: resourceType,
        resource_id: resourceId,
        field_name: field,
        old_value: oldValue != null ? String(oldValue) : null,
        new_value: newValue != null ? String(newValue) : null,
      })
    } catch {}
  }, [user?.id, currentOrg?.id])

  const value: CollaborationContextType = {
    onlineUsers,
    myPresence,
    setCurrentPage,
    setCurrentResource,
    getUsersOnPage,
    getUsersOnResource,
    acquireLock,
    releaseLock,
    joinCollaboration,
    getLock,
    activeLocks,
    broadcastFieldUpdate,
    onFieldUpdate,
    logAction,
    logFieldChange,
    sessionId,
  }

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  )
}

// ════════════════════════════════════════════════
// Hooks
// ════════════════════════════════════════════════

export function useCollaboration() {
  const ctx = useContext(CollaborationContext)
  if (!ctx) throw new Error('useCollaboration must be used within CollaborationProvider')
  return ctx
}

// Hook for page-level tracking
export function usePageTracking(pagePath: string) {
  const { setCurrentPage, getUsersOnPage, logAction } = useCollaboration()
  const [othersOnPage, setOthersOnPage] = useState<PresenceUser[]>([])

  useEffect(() => {
    setCurrentPage(pagePath)
    logAction({ action: 'view', resource_type: 'page', resource_id: pagePath, page_path: pagePath })
  }, [pagePath])

  useEffect(() => {
    setOthersOnPage(getUsersOnPage(pagePath))
  }, [getUsersOnPage, pagePath])

  return { othersOnPage }
}

// Hook for resource-level locking + collaboration
export function useResourceLock(resourceType: string, resourceId: string | null, resourceName?: string) {
  const {
    acquireLock, releaseLock, joinCollaboration, getLock,
    getUsersOnResource, setCurrentResource, broadcastFieldUpdate,
    onFieldUpdate, logAction, logFieldChange,
  } = useCollaboration()

  const [lockState, setLockState] = useState<'none' | 'owned' | 'locked' | 'collaborative'>('none')
  const [lockHolder, setLockHolder] = useState<ResourceLock | null>(null)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [collaborators, setCollaborators] = useState<PresenceUser[]>([])
  const [fieldUpdates, setFieldUpdates] = useState<Map<string, FieldUpdate>>(new Map())
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (!resourceId) return
    setCurrentResource({ type: resourceType, id: resourceId, name: resourceName || '' })
    return () => setCurrentResource(undefined)
  }, [resourceType, resourceId, resourceName])

  // Try to acquire lock when resource opens
  const tryLock = useCallback(async () => {
    if (!resourceId) return
    const result = await acquireLock(resourceType, resourceId, resourceName || '')
    if (result.granted) {
      setLockState('owned')
      setLockHolder(result.lock || null)
    } else if (result.conflict) {
      setLockHolder(result.conflict)
      setLockState('locked')
      setShowConflictModal(true)
    }
  }, [resourceType, resourceId, resourceName])

  // Release on unmount
  useEffect(() => {
    return () => {
      if (resourceId && lockState === 'owned') {
        releaseLock(resourceType, resourceId)
      }
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [resourceId, lockState])

  // Subscribe to field updates in collaborative mode
  useEffect(() => {
    if (lockState !== 'collaborative' || !resourceId) return
    const cleanup = onFieldUpdate(resourceType, resourceId, (update) => {
      setFieldUpdates(prev => {
        const next = new Map(prev)
        next.set(update.field, update)
        // Clear after 3 seconds
        setTimeout(() => {
          setFieldUpdates(p => {
            const n = new Map(p)
            n.delete(update.field)
            return n
          })
        }, 3000)
        return next
      })
    })
    cleanupRef.current = cleanup
    return cleanup
  }, [lockState, resourceType, resourceId])

  // Update collaborator list
  useEffect(() => {
    if (!resourceId) return
    setCollaborators(getUsersOnResource(resourceType, resourceId))
  }, [getUsersOnResource, resourceType, resourceId])

  const handleJoinCollab = async () => {
    if (!resourceId) return
    await joinCollaboration(resourceType, resourceId)
    setLockState('collaborative')
    setShowConflictModal(false)
  }

  const handleWait = () => {
    setShowConflictModal(false)
    // Stay in read-only mode
  }

  const handleTakeover = async () => {
    if (!resourceId) return
    // Force-release the other person's lock and take it
    await releaseLock(resourceType, resourceId)
    const result = await acquireLock(resourceType, resourceId, resourceName || '')
    if (result.granted) {
      setLockState('owned')
      setLockHolder(result.lock || null)
    }
    setShowConflictModal(false)
  }

  const syncField = (field: string, value: any) => {
    if (!resourceId || lockState !== 'collaborative') return
    broadcastFieldUpdate(resourceType, resourceId, field, value)
  }

  const trackChange = (field: string, oldValue: any, newValue: any) => {
    if (!resourceId) return
    logFieldChange(resourceType, resourceId, field, oldValue, newValue)
  }

  return {
    lockState,
    lockHolder,
    showConflictModal,
    collaborators,
    fieldUpdates,
    tryLock,
    releaseLock: () => resourceId ? releaseLock(resourceType, resourceId) : undefined,
    handleJoinCollab,
    handleWait,
    handleTakeover,
    syncField,
    trackChange,
    isEditable: lockState === 'owned' || lockState === 'collaborative',
    isReadOnly: lockState === 'locked',
  }
}
