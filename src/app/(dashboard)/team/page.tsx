'use client'

import { useState } from 'react'
import { useTeamData, ROLE_CONFIG } from '@/lib/hooks/use-team-data'
import type { TeamMember } from '@/lib/hooks/use-team-data'
import { useWorkspace } from '@/lib/workspace-context'
import { MemberDetail } from '@/components/team/member-detail'
import { Plus, Users, Shield, MessageSquare, Search, Mail, Phone } from 'lucide-react'

export default function TeamPage() {
  const { currentOrg, organizations, loading: orgLoading } = useWorkspace()
  const {
    members, loading, isSuperAdmin, isAdmin,
    addMember, updateMember, deleteMember,
    getSetting, saveSetting,
  } = useTeamData()

  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [addingMember, setAddingMember] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<TeamMember['role']>('team_member')
  const [newTitle, setNewTitle] = useState('')
  const [search, setSearch] = useState('')
  const [showSlackConfig, setShowSlackConfig] = useState(false)

  const slackConfig = getSetting('slack_config') as any || {}

  const handleAddMember = async () => {
    if (!newName.trim()) return
    const maxRole = isSuperAdmin ? newRole : (newRole === 'super_admin' ? 'admin' : newRole)
    await addMember({
      display_name: newName.trim(),
      email: newEmail.trim() || null,
      role: maxRole,
      job_title: newTitle.trim() || null,
      status: 'invited',
    } as any)
    setNewName('')
    setNewEmail('')
    setNewRole('team_member')
    setNewTitle('')
    setAddingMember(false)
  }

  const filteredMembers = members.filter(m =>
    m.display_name.toLowerCase().includes(search.toLowerCase()) ||
    (m.email && m.email.toLowerCase().includes(search.toLowerCase())) ||
    (m.job_title && m.job_title.toLowerCase().includes(search.toLowerCase()))
  )

  const activeMembers = filteredMembers.filter(m => m.status === 'active')
  const otherMembers = filteredMembers.filter(m => m.status !== 'active')

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading team...</div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Team</h1>
          <p className="text-xs text-gray-400 mt-0.5">
            {currentOrg?.name} · {members.length} members
            {isSuperAdmin && ' · Super Admin View'}
            {!isSuperAdmin && isAdmin && ' · Admin View'}
          </p>
        </div>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <button onClick={() => setShowSlackConfig(!showSlackConfig)}
              className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
              <MessageSquare className="w-3.5 h-3.5" /> Slack Config
            </button>
          )}
          {isAdmin && (
            <button onClick={() => setAddingMember(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
              <Plus className="w-3.5 h-3.5" /> Add Member
            </button>
          )}
        </div>
      </div>

      {/* Slack Config Panel - Super Admin only */}
      {showSlackConfig && isSuperAdmin && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <MessageSquare className="w-4 h-4 text-[#4A154B]" />
            <h3 className="text-sm font-semibold text-np-dark">Slack Configuration</h3>
            <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${slackConfig.enabled ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
              {slackConfig.enabled ? 'Connected' : 'Disabled'}
            </span>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Webhook URL</label>
              <input
                value={slackConfig.webhook_url || ''}
                onChange={e => {
                  const updated = { ...slackConfig, webhook_url: e.target.value }
                  saveSetting('slack_config', updated)
                }}
                placeholder="https://hooks.slack.com/services/..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Bot Token</label>
              <input
                value={slackConfig.bot_token || ''}
                onChange={e => {
                  const updated = { ...slackConfig, bot_token: e.target.value }
                  saveSetting('slack_config', updated)
                }}
                placeholder="xoxb-..."
                type="password"
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => saveSetting('slack_config', { ...slackConfig, enabled: !slackConfig.enabled })}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg ${slackConfig.enabled ? 'bg-red-50 text-red-500' : 'bg-green-50 text-green-600'}`}>
                {slackConfig.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={() => {
                  fetch(slackConfig.webhook_url, {
                    method: 'POST',
                    body: JSON.stringify({ text: '✅ NPU Hub Slack integration test successful!' }),
                  }).then(() => alert('Test message sent!')).catch(() => alert('Failed to send test'))
                }}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-[#4A154B] text-white hover:opacity-90">
                Send Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Member Form */}
      {addingMember && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5">
          <h3 className="text-sm font-semibold text-np-dark mb-3">Add Team Member</h3>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Name *</label>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Full name" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Email</label>
              <input value={newEmail} onChange={e => setNewEmail(e.target.value)}
                placeholder="email@company.com" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Role</label>
              <select value={newRole} onChange={e => setNewRole(e.target.value as any)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                {Object.entries(ROLE_CONFIG).map(([key, config]) => {
                  if (!isSuperAdmin && key === 'super_admin') return null
                  return <option key={key} value={key}>{config.label}</option>
                })}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Job Title</label>
              <input value={newTitle} onChange={e => setNewTitle(e.target.value)}
                placeholder="Role / Title" className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddMember} className="btn-primary text-xs py-1.5 px-4">Add Member</button>
            <button onClick={() => { setAddingMember(false); setNewName(''); setNewEmail('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search team..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
      </div>

      {/* Role Legend - Super Admin only */}
      {isSuperAdmin && (
        <div className="flex gap-2 mb-4 flex-wrap">
          {Object.entries(ROLE_CONFIG).map(([key, config]) => {
            const count = members.filter(m => m.role === key).length
            if (count === 0) return null
            return (
              <span key={key} className="text-[9px] font-bold px-2 py-1 rounded-full"
                style={{ backgroundColor: config.bg, color: config.color }}>
                {config.label}: {count}
              </span>
            )
          })}
        </div>
      )}

      {/* Active Members */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
          <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
            Active Members ({activeMembers.length})
          </span>
        </div>
        <div className="divide-y divide-gray-50">
          {activeMembers.map(member => {
            const roleConfig = ROLE_CONFIG[member.role]
            return (
              <button key={member.id}
                onClick={() => setSelectedMember(member)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
                  style={{ backgroundColor: roleConfig.color }}>
                  {member.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-np-dark">{member.display_name}</span>
                    <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: roleConfig.bg, color: roleConfig.color }}>
                      {roleConfig.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {member.job_title && <span className="text-[10px] text-gray-500">{member.job_title}</span>}
                    {member.email && <span className="text-[10px] text-gray-400 flex items-center gap-0.5"><Mail className="w-2.5 h-2.5" />{member.email}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {member.slack_user_id && (
                    <span className="text-[9px] bg-[#4A154B]/10 text-[#4A154B] px-1.5 py-0.5 rounded font-medium">Slack</span>
                  )}
                  {member.phone && (
                    <Phone className="w-3 h-3 text-gray-300" />
                  )}
                </div>
              </button>
            )
          })}
          {activeMembers.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No active members found</div>
          )}
        </div>
      </div>

      {/* Inactive/Invited */}
      {otherMembers.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              Invited / Inactive ({otherMembers.length})
            </span>
          </div>
          <div className="divide-y divide-gray-50">
            {otherMembers.map(member => {
              const roleConfig = ROLE_CONFIG[member.role]
              return (
                <button key={member.id}
                  onClick={() => setSelectedMember(member)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left opacity-60">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-white font-bold text-xs flex-shrink-0 bg-gray-400">
                    {member.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium text-np-dark">{member.display_name}</span>
                    <span className="text-[9px] ml-2 uppercase text-gray-400 font-medium">{member.status}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Member Detail Panel */}
      <MemberDetail
        member={selectedMember}
        onClose={() => setSelectedMember(null)}
        onUpdate={updateMember}
        onDelete={deleteMember}
        isSuperAdmin={isSuperAdmin}
        isAdmin={isAdmin}
        allOrgs={organizations}
      />
    </div>
  )
}
