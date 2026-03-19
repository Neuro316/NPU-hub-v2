'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { usePermissions } from '@/lib/hooks/use-permissions'
import { createClient } from '@/lib/supabase-browser'
import { Shield, UserCheck, UserX, Send, Search, ChevronDown, X, Copy, Check } from 'lucide-react'

interface UserRow {
  user_id: string
  display_name: string
  email: string | null
  role: string
  status: string
  org_id: string
  org_name: string
  created_at: string
}

interface InviteRow {
  id: string
  email: string
  org_id: string
  org_name: string
  role: string
  program: string | null
  token: string
  used: boolean
  created_at: string
  expires_at: string
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  team_member: 'Team Member',
  facilitator: 'Facilitator',
  participant: 'Participant',
}

const STATUS_STYLES: Record<string, string> = {
  active: 'bg-green-50 text-green-700',
  pending: 'bg-amber-50 text-amber-700',
  rejected: 'bg-red-50 text-red-700',
  invited: 'bg-blue-50 text-blue-700',
}

export default function AdminUsersPage() {
  const { currentOrg, organizations, user } = useWorkspace()
  const { isAdmin, role } = usePermissions()
  const supabase = createClient()

  const [users, setUsers] = useState<UserRow[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [tab, setTab] = useState<'pending' | 'active' | 'invites'>('pending')
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviteProgram, setInviteProgram] = useState('')
  const [inviteOrgId, setInviteOrgId] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteResult, setInviteResult] = useState<{ url: string; message?: string } | null>(null)
  const [copiedUrl, setCopiedUrl] = useState(false)

  // Role edit
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [editRole, setEditRole] = useState('')

  const isSuperAdmin = role === 'super_admin'

  const fetchUsers = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)

    // Fetch team_profiles with org info — super_admin sees all orgs, admin sees their own
    const query = supabase
      .from('team_profiles')
      .select('user_id, display_name, email, role, status, org_id, created_at')
      .order('created_at', { ascending: false })

    if (!isSuperAdmin) {
      query.eq('org_id', currentOrg.id)
    }

    const { data: profiles } = await query

    // Map org names
    const orgMap: Record<string, string> = {}
    organizations.forEach(o => { orgMap[o.id] = o.name })

    const mapped: UserRow[] = (profiles || []).map(p => ({
      ...p,
      email: p.email || null,
      org_name: orgMap[p.org_id] || 'Unknown',
    }))

    setUsers(mapped)
    setLoading(false)
  }, [currentOrg?.id, isSuperAdmin, organizations])

  const fetchInvites = useCallback(async () => {
    if (!currentOrg) return

    const res = await fetch(`/api/admin/users/invites?org_id=${isSuperAdmin ? '' : currentOrg.id}`)
    if (res.ok) {
      const data = await res.json()
      setInvites(data.invites || [])
    }
  }, [currentOrg?.id, isSuperAdmin])

  useEffect(() => {
    if (currentOrg && isAdmin) {
      fetchUsers()
      fetchInvites()
    }
  }, [currentOrg?.id, isAdmin, fetchUsers, fetchInvites])

  // Set default invite org
  useEffect(() => {
    if (currentOrg && !inviteOrgId) {
      setInviteOrgId(currentOrg.id)
    }
  }, [currentOrg])

  const handleApprove = async (u: UserRow) => {
    setActionLoading(u.user_id + u.org_id)
    const res = await fetch('/api/admin/users/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.user_id, org_id: u.org_id }),
    })
    if (res.ok) await fetchUsers()
    setActionLoading(null)
  }

  const handleReject = async (u: UserRow) => {
    if (!confirm(`Reject ${u.display_name}? They will not be able to access the platform.`)) return
    setActionLoading(u.user_id + u.org_id)
    const res = await fetch('/api/admin/users/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.user_id, org_id: u.org_id }),
    })
    if (res.ok) await fetchUsers()
    setActionLoading(null)
  }

  const handleRoleChange = async (u: UserRow) => {
    if (!editRole || editRole === u.role) {
      setEditingUser(null)
      return
    }
    setActionLoading(u.user_id + u.org_id)
    const res = await fetch('/api/admin/users/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.user_id, org_id: u.org_id, role: editRole }),
    })
    if (res.ok) await fetchUsers()
    setEditingUser(null)
    setActionLoading(null)
  }

  const handleRevoke = async (u: UserRow) => {
    if (!confirm(`Revoke access for ${u.display_name}? They will be removed from the organization.`)) return
    setActionLoading(u.user_id + u.org_id)
    const res = await fetch('/api/admin/users/reject', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: u.user_id, org_id: u.org_id, status: 'rejected' }),
    })
    if (res.ok) await fetchUsers()
    setActionLoading(null)
  }

  const handleSendInvite = async () => {
    if (!inviteEmail.trim() || !inviteOrgId) return
    setInviteLoading(true)
    setInviteResult(null)

    const res = await fetch('/api/admin/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: inviteEmail.trim(),
        org_id: inviteOrgId,
        role: inviteRole,
        program: inviteProgram.trim() || undefined,
      }),
    })

    const data = await res.json()
    if (res.ok && data.invite_url) {
      setInviteResult({ url: data.invite_url, message: data.message })
      setInviteEmail('')
      setInviteProgram('')
      fetchInvites()
    } else {
      alert(data.error || 'Failed to send invite')
    }
    setInviteLoading(false)
  }

  const copyInviteUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  // Filter users
  const filterSearch = (u: UserRow) =>
    !search ||
    u.display_name.toLowerCase().includes(search.toLowerCase()) ||
    (u.email && u.email.toLowerCase().includes(search.toLowerCase()))

  const pendingUsers = users.filter(u => u.status === 'pending' && filterSearch(u))
  const activeUsers = users.filter(u => u.status === 'active' && filterSearch(u))
  const allInvites = invites.filter(i =>
    !search || i.email.toLowerCase().includes(search.toLowerCase())
  )

  // Access gate
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Shield className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Admin access required</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading users...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">User Management</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {isSuperAdmin ? 'All organizations' : currentOrg?.name} · {pendingUsers.length} pending
          </p>
        </div>
        <button
          onClick={() => { setShowInviteForm(true); setInviteResult(null) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90"
        >
          <Send className="w-3.5 h-3.5" /> Send Invite
        </button>
      </div>

      {/* Invite Form Modal */}
      {showInviteForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 relative">
          <button onClick={() => { setShowInviteForm(false); setInviteResult(null) }}
            className="absolute top-3 right-3 p-1 hover:bg-gray-100 rounded">
            <X className="w-4 h-4 text-gray-400" />
          </button>
          <h3 className="text-sm font-semibold text-np-dark mb-3">Send Invite</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Email *</label>
              <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                placeholder="user@example.com" type="email"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Organization</label>
              <select value={inviteOrgId} onChange={e => setInviteOrgId(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                {(isSuperAdmin ? organizations : organizations.filter(o => o.id === currentOrg?.id)).map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Role</label>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Program (optional)</label>
              <input value={inviteProgram} onChange={e => setInviteProgram(e.target.value)}
                placeholder="e.g. Spring 2026 Cohort"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <button onClick={handleSendInvite} disabled={inviteLoading || !inviteEmail.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 disabled:opacity-50">
              {inviteLoading ? 'Sending...' : 'Send Invite'}
            </button>
            <button onClick={() => { setShowInviteForm(false); setInviteResult(null) }}
              className="px-4 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
          </div>

          {/* Invite result */}
          {inviteResult && (
            <div className="mt-3 p-3 bg-green-50 border border-green-100 rounded-lg">
              <p className="text-xs text-green-700 font-medium mb-1">
                {inviteResult.message || 'Invite sent!'}
              </p>
              <div className="flex items-center gap-2">
                <input readOnly value={inviteResult.url}
                  className="flex-1 text-xs bg-white border border-green-200 rounded px-2 py-1 text-gray-600" />
                <button onClick={() => copyInviteUrl(inviteResult.url)}
                  className="flex items-center gap-1 px-2 py-1 bg-white border border-green-200 rounded text-xs text-green-700 hover:bg-green-50">
                  {copiedUrl ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  {copiedUrl ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search users..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 rounded-lg p-0.5 w-fit">
        {[
          { key: 'pending' as const, label: 'Pending', count: pendingUsers.length },
          { key: 'active' as const, label: 'Active', count: activeUsers.length },
          { key: 'invites' as const, label: 'Invites', count: allInvites.length },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            {t.count > 0 && (
              <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${
                tab === t.key ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-200 text-gray-500'
              }`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pending Users */}
      {tab === 'pending' && (
        <div className="space-y-2">
          {pendingUsers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No pending users</div>
          ) : pendingUsers.map(u => (
            <div key={u.user_id + u.org_id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-np-dark truncate">{u.display_name}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[u.status] || 'bg-gray-100 text-gray-600'}`}>
                    {u.status}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{u.email || 'No email'}</p>
                <p className="text-[10px] text-gray-300 mt-0.5">
                  {isSuperAdmin && <span>{u.org_name} · </span>}
                  Requested {new Date(u.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2 ml-4">
                <button
                  onClick={() => handleApprove(u)}
                  disabled={actionLoading === u.user_id + u.org_id}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 rounded-lg text-xs font-medium hover:bg-green-100 disabled:opacity-50"
                >
                  <UserCheck className="w-3.5 h-3.5" /> Approve
                </button>
                <button
                  onClick={() => handleReject(u)}
                  disabled={actionLoading === u.user_id + u.org_id}
                  className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50"
                >
                  <UserX className="w-3.5 h-3.5" /> Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Active Users */}
      {tab === 'active' && (
        <div className="space-y-2">
          {activeUsers.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No active users</div>
          ) : activeUsers.map(u => (
            <div key={u.user_id + u.org_id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-np-dark truncate">{u.display_name}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_STYLES[u.status]}`}>
                    {u.status}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {ROLE_LABELS[u.role] || u.role}
                  </span>
                </div>
                <p className="text-xs text-gray-400 truncate">{u.email || 'No email'}</p>
                {isSuperAdmin && <p className="text-[10px] text-gray-300 mt-0.5">{u.org_name}</p>}
              </div>
              <div className="flex gap-2 ml-4 items-center">
                {/* Role edit */}
                {editingUser === u.user_id + u.org_id ? (
                  <div className="flex items-center gap-1">
                    <select value={editRole} onChange={e => setEditRole(e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                      {Object.entries(ROLE_LABELS).map(([key, label]) => {
                        if (key === 'super_admin' && !isSuperAdmin) return null
                        return <option key={key} value={key}>{label}</option>
                      })}
                    </select>
                    <button onClick={() => handleRoleChange(u)}
                      className="px-2 py-1 bg-np-blue text-white rounded text-[10px] font-medium hover:bg-np-blue/90">
                      Save
                    </button>
                    <button onClick={() => setEditingUser(null)}
                      className="px-2 py-1 border border-gray-200 rounded text-[10px] text-gray-500 hover:bg-gray-50">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => { setEditingUser(u.user_id + u.org_id); setEditRole(u.role) }}
                      className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50"
                    >
                      <ChevronDown className="w-3 h-3" /> Role
                    </button>
                    {u.user_id !== user?.id && (
                      <button
                        onClick={() => handleRevoke(u)}
                        disabled={actionLoading === u.user_id + u.org_id}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-50 text-red-700 rounded-lg text-xs font-medium hover:bg-red-100 disabled:opacity-50"
                      >
                        <UserX className="w-3.5 h-3.5" /> Revoke
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Invites Tab */}
      {tab === 'invites' && (
        <div className="space-y-2">
          {allInvites.length === 0 ? (
            <div className="text-center py-12 text-gray-400 text-sm">No invites sent</div>
          ) : allInvites.map(i => (
            <div key={i.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-np-dark truncate">{i.email}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    i.used ? 'bg-green-50 text-green-700' :
                    new Date(i.expires_at) < new Date() ? 'bg-gray-100 text-gray-500' :
                    'bg-blue-50 text-blue-700'
                  }`}>
                    {i.used ? 'Accepted' : new Date(i.expires_at) < new Date() ? 'Expired' : 'Pending'}
                  </span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                    {i.role}
                  </span>
                </div>
                <p className="text-[10px] text-gray-300 mt-0.5">
                  {isSuperAdmin && <span>{i.org_name} · </span>}
                  {i.program && <span>{i.program} · </span>}
                  Sent {new Date(i.created_at).toLocaleDateString()}
                  {!i.used && new Date(i.expires_at) > new Date() && (
                    <span> · Expires {new Date(i.expires_at).toLocaleDateString()}</span>
                  )}
                </p>
              </div>
              {!i.used && new Date(i.expires_at) > new Date() && (
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/invite/${i.token}`
                    navigator.clipboard.writeText(url)
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs hover:bg-gray-50 ml-4"
                >
                  <Copy className="w-3 h-3" /> Copy Link
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
