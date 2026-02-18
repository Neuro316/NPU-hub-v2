'use client'

import { useState } from 'react'
import { useCollaboration } from '@/lib/hooks/use-collaboration'
import { Circle, Users, Lock, Eye, ChevronDown, Activity } from 'lucide-react'

export function CollaborationBar() {
  const { onlineUsers, myPresence, activeLocks } = useCollaboration()
  const [showPanel, setShowPanel] = useState(false)

  const totalOnline = onlineUsers.length + (myPresence ? 1 : 0)
  const myLocks = activeLocks.filter(l => l.locked_by === myPresence?.user_id)
  const otherLocks = activeLocks.filter(l => l.locked_by !== myPresence?.user_id)

  if (!myPresence) return null

  return (
    <div className="fixed top-0 left-64 right-0 h-10 bg-white/80 backdrop-blur-sm border-b border-gray-100 z-40 flex items-center justify-between px-4">

      {/* Left: Page context */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <Circle className="w-2 h-2 fill-green-500 text-green-500" />
          <span className="text-[10px] font-medium text-gray-500">{totalOnline} online</span>
        </div>

        {/* Active user avatars */}
        <div className="flex -space-x-1.5">
          {/* Me */}
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white ring-2 ring-white"
            style={{ backgroundColor: myPresence.avatar_color }}
            title={`${myPresence.user_name} (you)`}
          >
            {myPresence.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
          </div>

          {/* Others */}
          {onlineUsers.slice(0, 5).map(u => (
            <div
              key={u.user_id}
              className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold text-white ring-2 ring-white relative group"
              style={{ backgroundColor: u.avatar_color }}
              title={`${u.user_name} - ${u.current_page || 'browsing'}`}
            >
              {u.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}

              {/* Tooltip */}
              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 hidden group-hover:block z-50">
                <div className="bg-gray-900 text-white text-[9px] px-2 py-1.5 rounded-lg shadow-lg whitespace-nowrap">
                  <p className="font-bold">{u.user_name}</p>
                  <p className="text-gray-300">{u.current_page || 'Browsing'}</p>
                  {u.current_resource && (
                    <p className="text-blue-300">Editing: {u.current_resource.name}</p>
                  )}
                </div>
              </div>
            </div>
          ))}

          {onlineUsers.length > 5 && (
            <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center text-[8px] font-bold text-gray-500 ring-2 ring-white">
              +{onlineUsers.length - 5}
            </div>
          )}
        </div>
      </div>

      {/* Right: Lock indicators + expand */}
      <div className="flex items-center gap-3">

        {/* Active locks indicator */}
        {activeLocks.length > 0 && (
          <div className="flex items-center gap-1.5">
            <Lock className="w-3 h-3 text-amber-500" />
            <span className="text-[10px] text-amber-600 font-medium">
              {activeLocks.length} resource{activeLocks.length !== 1 ? 's' : ''} locked
            </span>
          </div>
        )}

        {/* Expand panel */}
        <button
          onClick={() => setShowPanel(!showPanel)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
        >
          <Activity className="w-3 h-3" />
          <ChevronDown className={`w-3 h-3 transition-transform ${showPanel ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {/* Expanded Panel */}
      {showPanel && (
        <div className="absolute top-full right-4 mt-1 w-80 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden">
          {/* Online Users */}
          <div className="p-3 border-b border-gray-100">
            <div className="flex items-center gap-1.5 mb-2">
              <Users className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Online Now</span>
            </div>
            <div className="space-y-1.5">
              {/* Me */}
              <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-blue-50">
                <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold text-white"
                  style={{ backgroundColor: myPresence.avatar_color }}>
                  {myPresence.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[10px] font-semibold text-np-dark">{myPresence.user_name}</span>
                  <span className="text-[8px] text-blue-500 ml-1">you</span>
                </div>
                <span className="text-[9px] text-gray-400">{myPresence.current_page}</span>
              </div>

              {/* Others */}
              {onlineUsers.map(u => (
                <div key={u.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50">
                  <div className="w-5 h-5 rounded-full flex items-center justify-center text-[7px] font-bold text-white relative"
                    style={{ backgroundColor: u.avatar_color }}>
                    {u.user_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                    <div className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500 ring-1 ring-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-[10px] font-medium text-np-dark">{u.user_name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[9px] text-gray-400">{u.current_page}</span>
                    {u.current_resource && (
                      <p className="text-[8px] text-blue-500">{u.current_resource.name}</p>
                    )}
                  </div>
                </div>
              ))}

              {onlineUsers.length === 0 && (
                <p className="text-[10px] text-gray-400 text-center py-2">No other team members online</p>
              )}
            </div>
          </div>

          {/* Active Locks */}
          {activeLocks.length > 0 && (
            <div className="p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Lock className="w-3.5 h-3.5 text-amber-500" />
                <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Active Locks</span>
              </div>
              <div className="space-y-1.5">
                {activeLocks.map(lock => (
                  <div key={lock.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-50">
                    {lock.lock_mode === 'collaborative' ? (
                      <Users className="w-3.5 h-3.5 text-purple-500 flex-shrink-0" />
                    ) : (
                      <Lock className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <span className="text-[10px] font-medium text-np-dark capitalize">{lock.resource_type.replace('_', ' ')}</span>
                      <span className="text-[9px] text-gray-400 ml-1">by {lock.locked_by_name}</span>
                    </div>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                      lock.lock_mode === 'collaborative'
                        ? 'bg-purple-100 text-purple-600'
                        : 'bg-amber-100 text-amber-600'
                    }`}>
                      {lock.lock_mode === 'collaborative' ? `${(lock.collaborators?.length || 0) + 1} editing` : 'locked'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ════════════════════════════════════════════════
// Resource Lock Modal
// Shows when you try to edit something someone else is editing
// ════════════════════════════════════════════════
interface ResourceLockModalProps {
  show: boolean
  lockHolder: {
    locked_by_name: string
    locked_by_email: string
    lock_mode: string
    resource_type: string
  } | null
  onCollaborate: () => void
  onWait: () => void
  onTakeover: () => void
  isSuperAdmin?: boolean
}

export function ResourceLockModal({ show, lockHolder, onCollaborate, onWait, onTakeover, isSuperAdmin }: ResourceLockModalProps) {
  if (!show || !lockHolder) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onWait} />
      <div className="relative bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        {/* Icon */}
        <div className="w-12 h-12 rounded-xl bg-amber-100 flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-amber-600" />
        </div>

        <h3 className="text-sm font-bold text-np-dark text-center mb-1">
          {lockHolder.locked_by_name} is editing
        </h3>
        <p className="text-xs text-gray-400 text-center mb-5">
          This {lockHolder.resource_type.replace('_', ' ')} is currently being edited by {lockHolder.locked_by_name} ({lockHolder.locked_by_email}).
        </p>

        <div className="space-y-2">
          {/* Collaborate */}
          <button onClick={onCollaborate}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-purple-50 border-2 border-purple-200 hover:border-purple-400 transition-all text-left group">
            <Users className="w-5 h-5 text-purple-500" />
            <div>
              <span className="text-xs font-bold text-purple-700 block">Collaborate in real-time</span>
              <span className="text-[10px] text-purple-500">Both of you can edit simultaneously. Changes sync live.</span>
            </div>
          </button>

          {/* View only */}
          <button onClick={onWait}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-50 border-2 border-gray-200 hover:border-gray-400 transition-all text-left">
            <Eye className="w-5 h-5 text-gray-500" />
            <div>
              <span className="text-xs font-bold text-gray-700 block">View only (read-only)</span>
              <span className="text-[10px] text-gray-500">See the current state without editing. Wait for the lock to release.</span>
            </div>
          </button>

          {/* Takeover - Super Admin only */}
          {isSuperAdmin && (
            <button onClick={onTakeover}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 border-2 border-red-200 hover:border-red-400 transition-all text-left">
              <Lock className="w-5 h-5 text-red-500" />
              <div>
                <span className="text-xs font-bold text-red-700 block">Take over editing</span>
                <span className="text-[10px] text-red-500">Force-release their lock. They will lose unsaved changes.</span>
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════
// Field Sync Indicator
// Shows "Cameron is editing this field" badge
// ════════════════════════════════════════════════
interface FieldSyncBadgeProps {
  fieldUpdates: Map<string, { user_id: string; user_name: string; field: string; value: any; timestamp: string }>
  fieldName: string
}

export function FieldSyncBadge({ fieldUpdates, fieldName }: FieldSyncBadgeProps) {
  const update = fieldUpdates.get(fieldName)
  if (!update) return null

  return (
    <span className="inline-flex items-center gap-1 text-[8px] font-bold text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded-full animate-pulse">
      <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
      {update.user_name} editing
    </span>
  )
}
