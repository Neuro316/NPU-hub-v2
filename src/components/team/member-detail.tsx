'use client'

import { useState, useEffect } from 'react'
import type { TeamMember } from '@/lib/hooks/use-team-data'
import { ROLE_CONFIG } from '@/lib/hooks/use-team-data'
import { X, Trash2, Shield, Mail, Phone, MessageSquare, Building2 } from 'lucide-react'

interface Organization {
  id: string
  name: string
  slug: string
}

interface MemberDetailProps {
  member: TeamMember | null
  onClose: () => void
  onUpdate: (id: string, updates: Partial<TeamMember>) => Promise<any>
  onDelete: (id: string) => Promise<any>
  isSuperAdmin: boolean
  isAdmin: boolean
  allOrgs: Organization[]
}

export function MemberDetail({ member, onClose, onUpdate, onDelete, isSuperAdmin, isAdmin, allOrgs }: MemberDetailProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<TeamMember['role']>('team_member')
  const [slackId, setSlackId] = useState('')
  const [slackName, setSlackName] = useState('')
  const [status, setStatus] = useState<TeamMember['status']>('active')
  const [permissions, setPermissions] = useState<Record<string, any>>({})

  useEffect(() => {
    if (member) {
      setName(member.display_name)
      setEmail(member.email || '')
      setJobTitle(member.job_title || '')
      setPhone(member.phone || '')
      setRole(member.role)
      setSlackId(member.slack_user_id || '')
      setSlackName(member.slack_display_name || '')
      setStatus(member.status)
      setPermissions(member.permissions || {})
    }
  }, [member])

  if (!member) return null

  const save = async (field: string, value: any) => {
    await onUpdate(member.id, { [field]: value })
  }

  const handleDelete = async () => {
    if (confirm('Remove this team member?')) {
      await onDelete(member.id)
      onClose()
    }
  }

  const toggleWorkspace = (orgId: string) => {
    const orgs = permissions.workspace_access || []
    const updated = orgs.includes(orgId)
      ? orgs.filter((id: string) => id !== orgId)
      : [...orgs, orgId]
    const newPerms = { ...permissions, workspace_access: updated }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  const roleConfig = ROLE_CONFIG[role]
  const canEditRole = isSuperAdmin
  const canEditProfile = isAdmin
  const canDelete = isSuperAdmin && member.role !== 'super_admin'

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      <div className="relative w-full max-w-md bg-white shadow-xl border-l border-gray-100 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
              style={{ backgroundColor: roleConfig.color }}>
              {name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
            <div>
              <h3 className="text-sm font-bold text-np-dark">{name}</h3>
              <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: roleConfig.bg, color: roleConfig.color }}>
                {roleConfig.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {canDelete && (
              <button onClick={handleDelete} className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded hover:bg-gray-100">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Basic Info */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Profile</h4>

            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Display Name</label>
              {canEditProfile ? (
                <input value={name} onChange={e => setName(e.target.value)}
                  onBlur={() => name !== member.display_name && save('display_name', name)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              ) : (
                <p className="text-sm text-np-dark">{name}</p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5"><Mail className="w-3 h-3" /> Email</label>
              {canEditProfile ? (
                <input value={email} onChange={e => setEmail(e.target.value)}
                  onBlur={() => email !== (member.email || '') && save('email', email)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              ) : (
                <p className="text-sm text-np-dark">{email || 'Not set'}</p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5"><Phone className="w-3 h-3" /> Phone</label>
              {canEditProfile ? (
                <input value={phone} onChange={e => setPhone(e.target.value)}
                  onBlur={() => phone !== (member.phone || '') && save('phone', phone || null)}
                  placeholder="(555) 123-4567"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              ) : (
                <p className="text-sm text-np-dark">{phone || 'Not set'}</p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Job Title</label>
              {canEditProfile ? (
                <input value={jobTitle} onChange={e => setJobTitle(e.target.value)}
                  onBlur={() => jobTitle !== (member.job_title || '') && save('job_title', jobTitle || null)}
                  placeholder="Role / Title"
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              ) : (
                <p className="text-sm text-np-dark">{jobTitle || 'Not set'}</p>
              )}
            </div>
          </div>

          {/* Slack Integration - Admin+ */}
          {isAdmin && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <MessageSquare className="w-3 h-3" /> Slack Integration
              </h4>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Slack User ID</label>
                <input value={slackId} onChange={e => setSlackId(e.target.value)}
                  onBlur={() => slackId !== (member.slack_user_id || '') && save('slack_user_id', slackId || null)}
                  placeholder="U01ABCDEF"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
              </div>
              <div>
                <label className="text-[10px] text-gray-500 block mb-0.5">Slack Display Name</label>
                <input value={slackName} onChange={e => setSlackName(e.target.value)}
                  onBlur={() => slackName !== (member.slack_display_name || '') && save('slack_display_name', slackName || null)}
                  placeholder="@cameron"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              </div>
            </div>
          )}

          {/* Role & Permissions - Super Admin only */}
          {isSuperAdmin && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                <Shield className="w-3 h-3" /> Role & Permissions
              </h4>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">Role</label>
                <div className="space-y-1.5">
                  {(Object.keys(ROLE_CONFIG) as Array<keyof typeof ROLE_CONFIG>).map(key => {
                    const config = ROLE_CONFIG[key]
                    return (
                      <button key={key}
                        onClick={() => { setRole(key); save('role', key) }}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border-2 transition-all text-left"
                        style={{ borderColor: role === key ? config.color : 'transparent', backgroundColor: role === key ? config.bg : '#F9FAFB' }}>
                        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: config.color }} />
                        <div>
                          <span className="text-xs font-semibold" style={{ color: role === key ? config.color : '#374151' }}>{config.label}</span>
                          <p className="text-[9px] text-gray-400">{config.description}</p>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div>
                <label className="text-[10px] text-gray-500 block mb-1.5">Status</label>
                <div className="flex gap-2">
                  {(['active', 'invited', 'inactive'] as const).map(s => (
                    <button key={s}
                      onClick={() => { setStatus(s); save('status', s) }}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 capitalize transition-all ${status === s ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {/* Workspace Access */}
              <div>
                <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-1.5">
                  <Building2 className="w-3 h-3" /> Workspace Access
                </label>
                <div className="space-y-1.5">
                  {allOrgs.map(org => {
                    const hasAccess = (permissions.workspace_access || []).includes(org.id)
                    return (
                      <button key={org.id}
                        onClick={() => toggleWorkspace(org.id)}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left ${hasAccess ? 'border-green-300 bg-green-50' : 'border-gray-200 bg-gray-50'}`}>
                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${hasAccess ? 'border-green-500 bg-green-500' : 'border-gray-300'}`}>
                          {hasAccess && <span className="text-white text-[8px] font-bold">✓</span>}
                        </div>
                        <span className="text-xs font-medium text-np-dark">{org.name}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-gray-100 text-[10px] text-gray-400">
          Added {new Date(member.created_at).toLocaleDateString()}
          {member.updated_at !== member.created_at && (
            <span> · Updated {new Date(member.updated_at).toLocaleDateString()}</span>
          )}
        </div>
      </div>
    </div>
  )
}
