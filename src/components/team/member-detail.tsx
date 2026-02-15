'use client'

import { useState, useEffect } from 'react'
import type { TeamMember } from '@/lib/hooks/use-team-data'
import { ROLE_CONFIG } from '@/lib/hooks/use-team-data'
import {
  X, Trash2, Shield, Mail, Phone, MessageSquare, Building2, User,
  LayoutDashboard, Route, CheckSquare, Megaphone, Target, Rocket, Image,
  Brain, FileText, Lightbulb, Users, Calendar, BookOpen, Mic, TicketCheck,
  BarChart3, Activity, Settings, Eye, Pencil, ChevronDown, ChevronRight
} from 'lucide-react'

// Every module in the app with view/edit capability
const MODULES = [
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, category: 'core' },
  { key: 'journeys', label: 'Journey Builder', icon: Route, category: 'core' },
  { key: 'tasks', label: 'Task Manager', icon: CheckSquare, category: 'core' },
  { key: 'campaigns', label: 'Campaigns', icon: Megaphone, category: 'marketing' },
  { key: 'social', label: 'Social Media', icon: Target, category: 'marketing' },
  { key: 'shipit', label: 'ShipIt Journal', icon: Rocket, category: 'core' },
  { key: 'media', label: 'Media Library', icon: Image, category: 'content' },
  { key: 'advisory', label: 'AI Advisory', icon: Brain, category: 'ai', hasSubPerms: true },
  { key: 'sops', label: 'SOPs', icon: FileText, category: 'content' },
  { key: 'ideas', label: 'Ideas', icon: Lightbulb, category: 'content' },
  { key: 'icps', label: 'ICP Profiles', icon: Users, category: 'marketing' },
  { key: 'calendar', label: 'Calendar', icon: Calendar, category: 'core' },
  { key: 'library', label: 'Company Library', icon: BookOpen, category: 'content' },
  { key: 'media_appearances', label: 'Media Appearances', icon: Mic, category: 'marketing' },
  { key: 'tickets', label: 'Support Tickets', icon: TicketCheck, category: 'core' },
  { key: 'crm', label: 'CRM', icon: Users, category: 'core' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3, category: 'admin' },
  { key: 'integrations', label: 'Integrations', icon: Activity, category: 'admin' },
  { key: 'team', label: 'Team', icon: Users, category: 'admin' },
  { key: 'settings', label: 'Settings', icon: Settings, category: 'admin' },
] as const

// AI Advisory sub-permissions
const AI_SUB_PERMS = [
  { key: 'advisory_hub_guide', label: 'Hub Guide', desc: 'Use the platform navigation assistant' },
  { key: 'advisory_cameron_chat', label: 'Cameron AI Chat', desc: 'Ask Cameron AI questions' },
  { key: 'advisory_cameron_feed', label: 'Cameron AI Feed', desc: 'Upload knowledge to Cameron AI' },
  { key: 'advisory_voices_chat', label: 'Board Voices Chat', desc: 'Chat with advisory board voices' },
  { key: 'advisory_voices_edit', label: 'Board Voices Edit', desc: 'Create, edit, or delete advisory voices' },
  { key: 'advisory_voices_feed', label: 'Board Voices Feed', desc: 'Upload knowledge to advisory voices' },
] as const

const CATEGORIES = [
  { key: 'core', label: 'Core' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'content', label: 'Content' },
  { key: 'ai', label: 'AI' },
  { key: 'admin', label: 'Admin' },
]

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
  isOwnProfile: boolean
  allOrgs: Organization[]
}

export function MemberDetail({ member, onClose, onUpdate, onDelete, isSuperAdmin, isAdmin, isOwnProfile, allOrgs }: MemberDetailProps) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [role, setRole] = useState<TeamMember['role']>('team_member')
  const [slackId, setSlackId] = useState('')
  const [slackName, setSlackName] = useState('')
  const [status, setStatus] = useState<TeamMember['status']>('active')
  const [permissions, setPermissions] = useState<Record<string, any>>({})
  const [advisoryOpen, setAdvisoryOpen] = useState(false)

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

  // Module permission helpers
  const getModulePerm = (moduleKey: string): 'none' | 'view' | 'edit' => {
    return permissions.modules?.[moduleKey] || 'none'
  }

  const setModulePerm = (moduleKey: string, level: 'none' | 'view' | 'edit') => {
    const modules = { ...(permissions.modules || {}) }
    if (level === 'none') {
      delete modules[moduleKey]
    } else {
      modules[moduleKey] = level
    }
    const newPerms = { ...permissions, modules }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  const getAiSubPerm = (key: string): boolean => {
    return permissions.ai_advisory?.[key] ?? false
  }

  const setAiSubPerm = (key: string, enabled: boolean) => {
    const ai_advisory = { ...(permissions.ai_advisory || {}) }
    ai_advisory[key] = enabled
    const newPerms = { ...permissions, ai_advisory }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  // Bulk actions
  const grantAllView = () => {
    const modules: Record<string, string> = {}
    MODULES.forEach(m => { modules[m.key] = permissions.modules?.[m.key] === 'edit' ? 'edit' : 'view' })
    const newPerms = { ...permissions, modules }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  const grantAllEdit = () => {
    const modules: Record<string, string> = {}
    MODULES.forEach(m => { modules[m.key] = 'edit' })
    const ai_advisory: Record<string, boolean> = {}
    AI_SUB_PERMS.forEach(p => { ai_advisory[p.key] = true })
    const newPerms = { ...permissions, modules, ai_advisory }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  const revokeAll = () => {
    const newPerms = { ...permissions, modules: {}, ai_advisory: {} }
    setPermissions(newPerms)
    save('permissions', newPerms)
  }

  const roleConfig = ROLE_CONFIG[role]
  const canEditProfile = isOwnProfile || isAdmin
  const canEditSlack = isOwnProfile || isAdmin
  const canEditRole = isSuperAdmin
  const canEditPermissions = isSuperAdmin || isAdmin
  const canDelete = isSuperAdmin && member.role !== 'super_admin' && !isOwnProfile

  const moduleCount = Object.keys(permissions.modules || {}).length
  const editCount = Object.values(permissions.modules || {}).filter(v => v === 'edit').length

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
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-np-dark">{name}</h3>
                {isOwnProfile && (
                  <span className="text-[8px] bg-np-blue/10 text-np-blue px-1.5 py-0.5 rounded font-bold">YOU</span>
                )}
              </div>
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

          {/* Profile Section - editable by self or admin+ */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <User className="w-3 h-3" /> Profile
              {isOwnProfile && <span className="text-np-blue">(Your Profile)</span>}
            </h4>

            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Display Name</label>
              {canEditProfile ? (
                <input value={name} onChange={e => setName(e.target.value)}
                  onBlur={() => name !== member.display_name && save('display_name', name)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              ) : (
                <p className="text-sm text-np-dark py-2">{name}</p>
              )}
            </div>

            <div>
              <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5"><Mail className="w-3 h-3" /> Email</label>
              {canEditProfile ? (
                <input value={email} onChange={e => setEmail(e.target.value)}
                  onBlur={() => email !== (member.email || '') && save('email', email)}
                  className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              ) : (
                <p className="text-sm text-np-dark py-2">{email || 'Not set'}</p>
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
                <p className="text-sm text-np-dark py-2">{phone || 'Not set'}</p>
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
                <p className="text-sm text-np-dark py-2">{jobTitle || 'Not set'}</p>
              )}
            </div>
          </div>

          {/* Slack - editable by self or admin+ */}
          <div className="space-y-3">
            <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
              <MessageSquare className="w-3 h-3" /> Slack Integration
            </h4>
            <p className="text-[9px] text-gray-400">Your Slack ID is used for task notifications and @mentions</p>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Slack User ID</label>
              {canEditSlack ? (
                <input value={slackId} onChange={e => setSlackId(e.target.value)}
                  onBlur={() => slackId !== (member.slack_user_id || '') && save('slack_user_id', slackId || null)}
                  placeholder="U01ABCDEF"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 font-mono" />
              ) : (
                <p className="text-xs text-np-dark py-2 font-mono">{slackId || 'Not set'}</p>
              )}
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Slack Display Name</label>
              {canEditSlack ? (
                <input value={slackName} onChange={e => setSlackName(e.target.value)}
                  onBlur={() => slackName !== (member.slack_display_name || '') && save('slack_display_name', slackName || null)}
                  placeholder="@yourname"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
              ) : (
                <p className="text-xs text-np-dark py-2">{slackName || 'Not set'}</p>
              )}
            </div>
          </div>

          {/* Role & Permissions - Admin+ */}
          {canEditPermissions && (
            <div className="space-y-4">
              {/* Role selector - Super Admin only */}
              {isSuperAdmin && (
                <div className="space-y-3">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Role
                  </h4>
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
              )}

              {/* Status */}
              {isSuperAdmin && (
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</label>
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
              )}

              {/* Module Permissions */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
                    <Shield className="w-3 h-3" /> Module Permissions
                  </h4>
                  <span className="text-[9px] text-gray-400">{moduleCount} modules · {editCount} edit</span>
                </div>

                {/* Bulk actions */}
                <div className="flex gap-1.5">
                  <button onClick={grantAllView} className="text-[9px] text-gray-500 px-2 py-1 rounded border border-gray-200 hover:bg-gray-50">All View</button>
                  <button onClick={grantAllEdit} className="text-[9px] text-np-blue px-2 py-1 rounded border border-np-blue/20 hover:bg-np-blue/5">All Edit</button>
                  <button onClick={revokeAll} className="text-[9px] text-red-400 px-2 py-1 rounded border border-red-200 hover:bg-red-50">Revoke All</button>
                </div>

                {/* Module grid by category */}
                {CATEGORIES.map(cat => {
                  const catModules = MODULES.filter(m => m.category === cat.key)
                  if (catModules.length === 0) return null
                  return (
                    <div key={cat.key}>
                      <div className="text-[9px] font-bold text-gray-300 uppercase tracking-wider mb-1.5">{cat.label}</div>
                      <div className="space-y-1">
                        {catModules.map(mod => {
                          const perm = getModulePerm(mod.key)
                          const Icon = mod.icon
                          return (
                            <div key={mod.key}>
                              <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50 group">
                                <Icon className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                <span className="text-[11px] text-np-dark flex-1 font-medium">{mod.label}</span>

                                {/* None / View / Edit toggle */}
                                <div className="flex bg-gray-100 rounded-md p-0.5">
                                  {(['none', 'view', 'edit'] as const).map(level => (
                                    <button key={level} onClick={() => setModulePerm(mod.key, level)}
                                      className={`text-[8px] font-bold px-2 py-0.5 rounded transition-all flex items-center gap-0.5 ${
                                        perm === level
                                          ? level === 'none' ? 'bg-white text-gray-500 shadow-sm'
                                          : level === 'view' ? 'bg-white text-amber-600 shadow-sm'
                                          : 'bg-white text-green-600 shadow-sm'
                                          : 'text-gray-400 hover:text-gray-600'
                                      }`}>
                                      {level === 'none' && <X className="w-2.5 h-2.5" />}
                                      {level === 'view' && <Eye className="w-2.5 h-2.5" />}
                                      {level === 'edit' && <Pencil className="w-2.5 h-2.5" />}
                                      {level === 'none' ? 'Off' : level === 'view' ? 'View' : 'Edit'}
                                    </button>
                                  ))}
                                </div>

                                {/* AI Advisory expand arrow */}
                                {'hasSubPerms' in mod && (mod as any).hasSubPerms && perm !== 'none' && (
                                  <button onClick={() => setAdvisoryOpen(!advisoryOpen)} className="text-gray-400 hover:text-np-blue p-0.5">
                                    {advisoryOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  </button>
                                )}
                              </div>

                              {/* AI Advisory sub-permissions */}
                              {'hasSubPerms' in mod && (mod as any).hasSubPerms && advisoryOpen && perm !== 'none' && (
                                <div className="ml-8 pl-3 border-l-2 border-purple-100 space-y-1 py-1.5 mb-1">
                                  <div className="text-[9px] font-bold text-purple-400 uppercase tracking-wider mb-1">AI Advisory Permissions</div>
                                  {AI_SUB_PERMS.map(sub => {
                                    const enabled = getAiSubPerm(sub.key)
                                    return (
                                      <button key={sub.key}
                                        onClick={() => setAiSubPerm(sub.key, !enabled)}
                                        className="w-full flex items-center gap-2.5 py-1 px-2 rounded-lg hover:bg-purple-50/50 transition-all text-left">
                                        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                          enabled ? 'border-purple-500 bg-purple-500' : 'border-gray-300'
                                        }`}>
                                          {enabled && <span className="text-white text-[8px] font-bold">✓</span>}
                                        </div>
                                        <div>
                                          <div className="text-[10px] font-semibold text-np-dark">{sub.label}</div>
                                          <div className="text-[8px] text-gray-400">{sub.desc}</div>
                                        </div>
                                      </button>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Workspace Access - Super Admin only */}
              {isSuperAdmin && allOrgs.length > 1 && (
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1.5">
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
              )}
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

