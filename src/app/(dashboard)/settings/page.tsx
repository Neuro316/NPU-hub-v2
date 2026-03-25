'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Mail, Phone, Brain, Shield, Bell, Users, Sliders,
  Save, Plus, X, Trash2, CheckCircle2, AlertTriangle,
  LayoutGrid, Eye, EyeOff, Search, Activity, History,
  BarChart3, ChevronRight, ChevronDown, ArrowUp, ArrowDown,
  GripVertical, RotateCcw,
} from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData, ROLE_CONFIG } from '@/lib/hooks/use-team-data'
import type { TeamMember } from '@/lib/hooks/use-team-data'
import { MemberDetail } from '@/components/team/member-detail'
import { navCategories, REORDERABLE_IDS } from '@/lib/nav-config'
import type { SidebarOrder } from '@/lib/nav-config'
import { createClient } from '@/lib/supabase-browser'

type Section = 'email' | 'twilio' | 'ai' | 'pipeline' | 'team' | 'notifications' | 'compliance' | 'general' | 'modules' | 'admin_tools' | 'sidebar_layout'

const SECTIONS: { id: Section; label: string; icon: any }[] = [
  { id: 'general', label: 'General', icon: Sliders },
  { id: 'modules', label: 'Modules', icon: LayoutGrid },
  { id: 'sidebar_layout', label: 'Sidebar Layout', icon: GripVertical },
  { id: 'team', label: 'Team', icon: Users },
  { id: 'admin_tools', label: 'Admin Tools', icon: Shield },
  { id: 'email', label: 'Email', icon: Mail },
  { id: 'twilio', label: 'Twilio / SMS', icon: Phone },
  { id: 'ai', label: 'AI Integration', icon: Brain },
  { id: 'pipeline', label: 'Pipeline', icon: Sliders },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'compliance', label: 'Compliance', icon: Shield },
]

/** Swap two adjacent items in an array */
function moveInArray<T>(arr: T[], index: number, direction: 'up' | 'down'): T[] {
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= arr.length) return arr
  const result = [...arr]
  ;[result[index], result[target]] = [result[target], result[index]]
  return result
}

/* All sidebar modules that can be toggled, grouped by category.
   'dashboard' and 'settings' are excluded — they must always be visible. */
const SIDEBAR_MODULES: { category: string; items: { key: string; label: string }[] }[] = [
  {
    category: 'GROW',
    items: [
      { key: 'crm', label: 'CRM' },
      { key: 'campaigns', label: 'Campaigns' },
      { key: 'media_affiliates', label: 'Media & Affiliates' },
      { key: 'icps', label: 'ICP Profiles' },
      { key: 'analytics', label: 'Analytics' },
      { key: 'media_appearances', label: 'Media Appearances' },
    ],
  },
  {
    category: 'CREATE',
    items: [
      { key: 'social', label: 'Social Media' },
      { key: 'media', label: 'Media Library' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'shipit', label: 'ShipIt Journal' },
      { key: 'ideas', label: 'Ideas' },
      { key: 'library', label: 'Company Library' },
    ],
  },
  {
    category: 'OPERATE',
    items: [
      { key: 'meetings', label: 'Meetings' },
      { key: 'rocks', label: 'Rocks' },
      { key: 'tasks', label: 'Tasks (My Tasks / Manager / Client)' },
      { key: 'journeys', label: 'Journey Builder' },
      { key: 'sops', label: 'SOPs' },
      { key: 'tickets', label: 'Support Tickets' },
    ],
  },
  {
    category: 'INTELLIGENCE',
    items: [
      { key: 'advisory', label: 'AI Advisory' },
    ],
  },
  {
    category: 'FINANCE',
    items: [
      { key: 'finance_suite', label: 'AI CFO' },
      { key: 'np_financial', label: 'NP Financial' },
    ],
  },
  {
    category: 'ADMIN',
    items: [
      { key: 'platform_advisor', label: 'Platform Advisor' },
    ],
  },
]

type NumberPurpose = 'outreach' | 'client_relations' | 'appointments' | 'inbound_main' | 'general'
const NUMBER_PURPOSES: { value: NumberPurpose; label: string; desc: string }[] = [
  { value: 'outreach', label: 'Outreach', desc: 'Cold outreach, campaigns, sequences' },
  { value: 'client_relations', label: 'Client Relations', desc: 'Enrolled clients, support' },
  { value: 'appointments', label: 'Appointments', desc: 'Reminders, scheduling' },
  { value: 'inbound_main', label: 'Inbound Main Line', desc: 'Primary reception number' },
  { value: 'general', label: 'General', desc: 'Fallback for everything' },
]
interface TwilioNumber { phone: string; nickname: string; purpose: NumberPurpose }

export default function SettingsPage() {
  const { currentOrg, organizations, user } = useWorkspace()
  const {
    members, loading: teamLoading, isSuperAdmin, isAdmin,
    addMember, updateMember, deleteMember,
  } = useTeamData()
  const [active, setActive] = useState<Section>('general')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [twilioTest, setTwilioTest] = useState<{ loading: boolean; result: any | null }>({ loading: false, result: null })

  // Settings state
  const [email, setEmail] = useState({ sending_email: '', sending_name: '', daily_limit: 500, provider: 'gmail_workspace', warmup: true })
  const [twilio, setTwilio] = useState({ account_sid: '', auth_token: '', messaging_service_sid: '', api_key: '', api_secret: '', twiml_app_sid: '' })
  const [twilioNumbers, setTwilioNumbers] = useState<TwilioNumber[]>([{ phone: '', nickname: 'Primary', purpose: 'general' }])
  const [ai, setAi] = useState({
    anthropic_key: '', openai_key: '', gemini_key: '',
    call_summaries: true, smart_replies: true, sentiment: true, task_gen: true,
  })
  const [pipeline, setPipeline] = useState({ stages: 'New Lead,Contacted,Qualified,Proposal,Negotiation,Won,Lost' })
  const [compliance, setCompliance] = useState({ double_optin: false, auto_dnc_unsubscribe: true, retention_days: 365 })
  const [notifications, setNotifications] = useState({ new_lead: true, missed_call: true, task_overdue: true, campaign_complete: true })
  const [hiddenModules, setHiddenModules] = useState<string[]>([])

  // Sidebar layout state
  const defaultCategoryOrder = REORDERABLE_IDS
  const [categoryOrder, setCategoryOrder] = useState<string[]>(defaultCategoryOrder)
  const [itemOrders, setItemOrders] = useState<Record<string, string[]>>({})
  const [expandedLayoutCat, setExpandedLayoutCat] = useState<string | null>(null)

  // Helper: get current item order for a category (saved or default)
  const getItemOrder = (catId: string): string[] => {
    if (itemOrders[catId]?.length) return itemOrders[catId]
    const cat = navCategories.find(c => c.id === catId)
    return cat?.items.map(i => i.href) || []
  }

  // Team management state
  const [selectedMember, setSelectedMember] = useState<TeamMember | null>(null)
  const [addingMember, setAddingMember] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newRole, setNewRole] = useState<TeamMember['role']>('team_member')
  const [newTitle, setNewTitle] = useState('')
  const [teamSearch, setTeamSearch] = useState('')

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
    setNewName(''); setNewEmail(''); setNewRole('team_member'); setNewTitle(''); setAddingMember(false)
  }

  const filteredMembers = members.filter(m =>
    m.display_name.toLowerCase().includes(teamSearch.toLowerCase()) ||
    (m.email && m.email.toLowerCase().includes(teamSearch.toLowerCase())) ||
    (m.job_title && m.job_title.toLowerCase().includes(teamSearch.toLowerCase()))
  )
  const activeMembers = filteredMembers.filter(m => m.status === 'active')
  const otherMembers = filteredMembers.filter(m => m.status !== 'active')

  // Load settings from Supabase
  useEffect(() => {
    if (!currentOrg) return
    const supabase = createClient()
    supabase.from('org_email_configs').select('*').eq('org_id', currentOrg.id).maybeSingle()
      .then(({ data }) => {
        if (data) setEmail({ sending_email: data.sending_email || '', sending_name: data.sending_name || '', daily_limit: data.daily_send_limit || 500, provider: data.provider || 'gmail_workspace', warmup: data.warmup_enabled ?? true })
      })
    // Load Twilio + other settings from org_settings
    supabase.from('org_settings').select('setting_key, setting_value').eq('org_id', currentOrg.id)
      .in('setting_key', ['crm_twilio', 'crm_ai', 'crm_compliance', 'crm_notifications', 'hidden_modules', 'sidebar_order'])
      .then(({ data }) => {
        data?.forEach(row => {
          const v = row.setting_value
          if (row.setting_key === 'crm_twilio' && v) {
            setTwilio({ account_sid: v.account_sid || '', auth_token: v.auth_token || '', messaging_service_sid: v.messaging_service_sid || '', api_key: v.api_key || '', api_secret: v.api_secret || '', twiml_app_sid: v.twiml_app_sid || '' })
            if (v.numbers?.length) setTwilioNumbers(v.numbers)
          }
          if (row.setting_key === 'crm_ai' && v) setAi(prev => ({ ...prev, ...v }))
          if (row.setting_key === 'crm_compliance' && v) setCompliance(prev => ({ ...prev, ...v }))
          if (row.setting_key === 'crm_notifications' && v) setNotifications(prev => ({ ...prev, ...v }))
          if (row.setting_key === 'hidden_modules') {
            console.log('[Settings] Loaded hidden_modules from DB:', v)
            if (Array.isArray(v)) setHiddenModules(v)
          }
          if (row.setting_key === 'sidebar_order' && v && typeof v === 'object' && !Array.isArray(v)) {
            const so = v as SidebarOrder
            if (so.categories?.length) setCategoryOrder(so.categories)
            if (so.items) setItemOrders(so.items)
          }
        })
      })
  }, [currentOrg])

  const handleSave = async () => {
    if (!currentOrg) return
    setSaving(true)
    try {
      const supabase = createClient()
      if (active === 'email') {
        await supabase.from('org_email_configs').upsert({
          org_id: currentOrg.id, provider: email.provider,
          sending_email: email.sending_email, sending_name: email.sending_name,
          daily_send_limit: email.daily_limit, warmup_enabled: email.warmup,
          batch_size: 50, batch_delay_seconds: 10, is_verified: false,
        }, { onConflict: 'org_id' })
      }
      if (active === 'twilio') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_twilio',
          setting_value: { ...twilio, numbers: twilioNumbers },
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'ai') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_ai', setting_value: ai,
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'compliance') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_compliance', setting_value: compliance,
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'notifications') {
        await supabase.from('org_settings').upsert({
          org_id: currentOrg.id, setting_key: 'crm_notifications', setting_value: notifications,
        }, { onConflict: 'org_id,setting_key' })
      }
      if (active === 'modules') {
        console.log('[Settings] Saving hidden_modules:', hiddenModules)
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_id: currentOrg.id,
            setting_key: 'hidden_modules',
            setting_value: hiddenModules,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Unknown error' }))
          console.error('[Settings] Failed to save hidden_modules:', data)
          alert('Failed to save module settings: ' + (data.error || res.statusText))
          return
        }
        console.log('[Settings] hidden_modules saved successfully, reloading...')
        window.location.reload()
        return
      }
      if (active === 'sidebar_layout') {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            org_id: currentOrg.id,
            setting_key: 'sidebar_order',
            setting_value: { categories: categoryOrder, items: itemOrders } as SidebarOrder,
          }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: 'Unknown error' }))
          alert('Failed to save sidebar layout: ' + (data.error || res.statusText))
          return
        }
        window.location.reload()
        return
      }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e) { console.error(e); alert('Failed to save settings') }
    finally { setSaving(false) }
  }

  const addTwilioNumber = () => setTwilioNumbers(prev => [...prev, { phone: '', nickname: '', purpose: 'general' as NumberPurpose }])
  const removeTwilioNumber = (i: number) => setTwilioNumbers(prev => prev.filter((_, idx) => idx !== i))

  return (
    <div className="flex gap-6 animate-in fade-in duration-300">
      {/* Section Nav */}
      <div className="w-48 flex-shrink-0 space-y-0.5">
        {SECTIONS.map(s => (
          <button key={s.id} onClick={() => setActive(s.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              active === s.id ? 'bg-np-blue/8 text-np-blue border border-np-blue/20' : 'text-gray-500 hover:bg-gray-50 border border-transparent'
            }`}>
            <s.icon size={14} />{s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 max-w-3xl">
        <div className="rounded-xl border border-gray-100 bg-white p-6">
          {/* General */}
          {active === 'general' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">General Settings</h3>
              <p className="text-xs text-gray-400">Organization-level CRM configuration.</p>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Organization Name</label>
                <input value={currentOrg?.name || ''} disabled className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg bg-gray-50" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Default Timezone</label>
                <select className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                  <option value="America/New_York">Eastern (ET)</option>
                  <option value="America/Chicago">Central (CT)</option>
                  <option value="America/Denver">Mountain (MT)</option>
                  <option value="America/Los_Angeles">Pacific (PT)</option>
                </select>
              </div>
            </div>
          )}

          {/* Modules */}
          {active === 'modules' && (
            <div className="space-y-5">
              <div>
                <h3 className="text-sm font-bold text-np-dark">Sidebar Modules</h3>
                <p className="text-xs text-gray-400 mt-1">Toggle modules visible in the sidebar for this organization. Hidden modules won&apos;t appear for any user. Use this to hide incomplete features until they&apos;re ready.</p>
              </div>
              {SIDEBAR_MODULES.map(group => (
                <div key={group.category}>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">{group.category}</p>
                  <div className="space-y-1">
                    {group.items.map(item => {
                      const isHidden = hiddenModules.includes(item.key)
                      return (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => {
                            setHiddenModules(prev =>
                              isHidden
                                ? prev.filter(k => k !== item.key)
                                : [...prev, item.key]
                            )
                          }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors ${
                            isHidden
                              ? 'border-gray-100 bg-gray-50/50 text-gray-400'
                              : 'border-np-blue/20 bg-np-blue/5 text-np-dark'
                          }`}
                        >
                          <span className="text-xs font-medium">{item.label}</span>
                          {isHidden
                            ? <EyeOff size={14} className="text-gray-300" />
                            : <Eye size={14} className="text-np-blue" />
                          }
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
              <p className="text-[10px] text-gray-400 italic">Dashboard and Settings are always visible and cannot be hidden.</p>
            </div>
          )}

          {/* Sidebar Layout */}
          {active === 'sidebar_layout' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-bold text-np-dark">Sidebar Layout</h3>
                <p className="text-xs text-gray-400 mt-1">Reorder sidebar categories and items. Dashboard is always first, Admin always last.</p>
              </div>

              {/* Category Order */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Category Order</p>
                <div className="space-y-1">
                  {categoryOrder.map((catId, idx) => {
                    const cat = navCategories.find(c => c.id === catId)
                    if (!cat) return null
                    return (
                      <div key={catId} className="flex items-center gap-2 px-3 py-2.5 rounded-lg border border-gray-100 bg-white">
                        <GripVertical size={14} className="text-gray-300 flex-shrink-0" />
                        <span className="text-xs font-semibold text-np-dark flex-1">{cat.label || catId.toUpperCase()}</span>
                        <button
                          type="button"
                          onClick={() => setCategoryOrder(prev => moveInArray(prev, idx, 'up'))}
                          disabled={idx === 0}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                          <ArrowUp size={14} className="text-gray-500" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setCategoryOrder(prev => moveInArray(prev, idx, 'down'))}
                          disabled={idx === categoryOrder.length - 1}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-20 disabled:cursor-not-allowed"
                        >
                          <ArrowDown size={14} className="text-gray-500" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Item Order Within Categories */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Item Order Within Categories</p>
                <div className="space-y-1">
                  {/* Show all categories including home and admin for item reordering */}
                  {navCategories.filter(c => c.id !== 'home').map(cat => {
                    const isExpanded = expandedLayoutCat === cat.id
                    const currentItemOrder = getItemOrder(cat.id)
                    // Build ordered items list from hrefs
                    const orderedItems = currentItemOrder
                      .map(href => cat.items.find(i => i.href === href))
                      .filter(Boolean) as typeof cat.items
                    // Append any items not in the saved order
                    const missingItems = cat.items.filter(i => !currentItemOrder.includes(i.href))
                    const allItems = [...orderedItems, ...missingItems]

                    return (
                      <div key={cat.id}>
                        <button
                          type="button"
                          onClick={() => setExpandedLayoutCat(isExpanded ? null : cat.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <ChevronRight size={12} className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
                          <span className="text-xs font-semibold text-np-dark flex-1 text-left">{cat.label || 'HOME'}</span>
                          <span className="text-[10px] text-gray-400">{cat.items.length} items</span>
                        </button>
                        {isExpanded && (
                          <div className="ml-5 mt-1 space-y-0.5">
                            {allItems.map((item, idx) => {
                              const isHidden = hiddenModules.includes(item.moduleKey)
                              return (
                                <div key={item.href} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-50 bg-gray-50/50">
                                  <span className={`text-xs flex-1 ${isHidden ? 'text-gray-400' : 'text-np-dark'}`}>
                                    {item.label}
                                    {isHidden && <span className="text-[9px] text-gray-400 ml-1.5">(hidden)</span>}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const order = getItemOrder(cat.id)
                                      // Ensure we have the full list before moving
                                      const fullOrder = order.length >= allItems.length
                                        ? order
                                        : allItems.map(i => i.href)
                                      setItemOrders(prev => ({
                                        ...prev,
                                        [cat.id]: moveInArray(fullOrder, idx, 'up'),
                                      }))
                                    }}
                                    disabled={idx === 0}
                                    className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed"
                                  >
                                    <ArrowUp size={12} className="text-gray-500" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const order = getItemOrder(cat.id)
                                      const fullOrder = order.length >= allItems.length
                                        ? order
                                        : allItems.map(i => i.href)
                                      setItemOrders(prev => ({
                                        ...prev,
                                        [cat.id]: moveInArray(fullOrder, idx, 'down'),
                                      }))
                                    }}
                                    disabled={idx === allItems.length - 1}
                                    className="p-0.5 rounded hover:bg-gray-200 disabled:opacity-20 disabled:cursor-not-allowed"
                                  >
                                    <ArrowDown size={12} className="text-gray-500" />
                                  </button>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Reset */}
              <button
                type="button"
                onClick={() => {
                  setCategoryOrder(defaultCategoryOrder)
                  setItemOrders({})
                  setExpandedLayoutCat(null)
                }}
                className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-np-dark transition-colors"
              >
                <RotateCcw size={12} /> Reset to Default Order
              </button>
            </div>
          )}

          {/* Email */}
          {active === 'email' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Email Configuration</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sending Email</label>
                  <input value={email.sending_email} onChange={e => setEmail(p=>({...p,sending_email:e.target.value}))} placeholder="hello@neuroprogeny.com"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Sending Name</label>
                  <input value={email.sending_name} onChange={e => setEmail(p=>({...p,sending_name:e.target.value}))} placeholder="Cameron Allen"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Provider</label>
                  <select value={email.provider} onChange={e => setEmail(p=>({...p,provider:e.target.value}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg">
                    <option value="gmail_workspace">Gmail Workspace</option><option value="resend">Resend</option><option value="smtp">SMTP</option>
                  </select></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Daily Send Limit</label>
                  <input type="number" value={email.daily_limit} onChange={e => setEmail(p=>({...p,daily_limit:parseInt(e.target.value)||0}))}
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" /></div>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={email.warmup} onChange={e => setEmail(p=>({...p,warmup:e.target.checked}))} className="accent-teal w-3 h-3" />
                Enable warmup (gradually increase daily sends)
              </label>
            </div>
          )}

          {/* Twilio */}
          {active === 'twilio' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Twilio Configuration</h3>
              <p className="text-xs text-gray-400">Enter your Twilio credentials. Each organization can have its own account for complete separation.</p>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Account SID</label>
                  <input value={twilio.account_sid} onChange={e => setTwilio(p=>({...p,account_sid:e.target.value}))} placeholder="AC..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Auth Token</label>
                  <input type="password" value={twilio.auth_token} onChange={e => setTwilio(p=>({...p,auth_token:e.target.value}))} placeholder="â€¢â€¢â€¢â€¢â€¢â€¢"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Messaging Service SID</label>
                <input value={twilio.messaging_service_sid} onChange={e => setTwilio(p=>({...p,messaging_service_sid:e.target.value}))} placeholder="MG..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>

              {/* Voice SDK */}
              <div className="border-t border-gray-100 pt-4">
                <h4 className="text-xs font-semibold text-np-dark mb-2">Voice (Browser Calling)</h4>
                <p className="text-[10px] text-gray-400 mb-3">Required for making calls directly from the CRM. Create an API Key and TwiML App in your Twilio Console.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">API Key SID</label>
                    <input value={twilio.api_key} onChange={e => setTwilio(p=>({...p,api_key:e.target.value}))} placeholder="SK..."
                      className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                  <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">API Secret</label>
                    <input type="password" value={twilio.api_secret} onChange={e => setTwilio(p=>({...p,api_secret:e.target.value}))} placeholder="â€¢â€¢â€¢â€¢â€¢â€¢"
                      className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                </div>
                <div className="mt-3"><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">TwiML App SID</label>
                  <input value={twilio.twiml_app_sid} onChange={e => setTwilio(p=>({...p,twiml_app_sid:e.target.value}))} placeholder="AP..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>

              {/* Phone Numbers */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Phone Numbers</label>
                  <button onClick={addTwilioNumber} className="flex items-center gap-1 text-[10px] text-np-blue font-medium hover:underline"><Plus size={10} /> Add Number</button>
                </div>
                <p className="text-[10px] text-gray-400 mb-2">Assign numbers for campaigns (outreach) or clients (relationship management).</p>
                <div className="space-y-2">
                  {twilioNumbers.map((num, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg border border-gray-100 bg-gray-50/50">
                      <input value={num.phone} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,phone:e.target.value} : n))}
                        placeholder="+18285551234" className="w-36 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white font-mono" />
                      <input value={num.nickname} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,nickname:e.target.value} : n))}
                        placeholder="Nickname" className="w-28 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white" />
                      <select value={num.purpose} onChange={e => setTwilioNumbers(prev => prev.map((n,idx) => idx===i ? {...n,purpose:e.target.value as NumberPurpose} : n))}
                        className="flex-1 px-2 py-1.5 text-xs border border-gray-100 rounded-md bg-white">
                        {NUMBER_PURPOSES.map(p => <option key={p.value} value={p.value}>{p.label} - {p.desc}</option>)}
                      </select>
                      {i > 0 && <button onClick={() => removeTwilioNumber(i)} className="p-1 text-gray-400 hover:text-red-500"><Trash2 size={12} /></button>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Test Connection */}
              <div className="border-t border-gray-100 pt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={async () => {
                      if (!currentOrg) return
                      setTwilioTest({ loading: true, result: null })
                      try {
                        const res = await fetch('/api/twilio/test', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ org_id: currentOrg.id }),
                        })
                        const data = await res.json()
                        setTwilioTest({ loading: false, result: data })
                      } catch (e) {
                        setTwilioTest({ loading: false, result: { success: false, error: 'Network error' } })
                      }
                    }}
                    disabled={twilioTest.loading}
                    className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-50 transition-colors"
                  >
                    {twilioTest.loading ? 'Testing...' : 'Test Connection'}
                  </button>
                  <p className="text-[10px] text-gray-400">Save first, then test to verify credentials</p>
                </div>

                {twilioTest.result && (
                  <div className={`mt-3 rounded-lg border p-3 ${twilioTest.result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
                    <p className={`text-xs font-semibold mb-2 ${twilioTest.result.success ? 'text-green-700' : 'text-red-700'}`}>
                      {twilioTest.result.success ? 'âœ“ Connected successfully' : 'âœ— ' + twilioTest.result.error}
                    </p>
                    {twilioTest.result.checks && (
                      <div className="space-y-1">
                        {Object.entries(twilioTest.result.checks).map(([key, val]) => {
                          if (key.startsWith('account_') || key.startsWith('messaging_name') || key.startsWith('number_details')) return null
                          const isOk = val === true
                          const isFail = val === false
                          const label = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
                          return (
                            <div key={key} className="flex items-center gap-2 text-[10px]">
                              <span className={isOk ? 'text-green-600' : isFail ? 'text-red-500' : 'text-amber-500'}>
                                {isOk ? 'âœ“' : isFail ? 'âœ—' : 'âš '}
                              </span>
                              <span className="text-gray-600 font-medium">{label}:</span>
                              <span className="text-gray-500">{typeof val === 'string' ? val : isOk ? 'OK' : 'Not configured'}</span>
                            </div>
                          )
                        })}
                        {twilioTest.result.checks.account_name && (
                          <p className="text-[9px] text-gray-400 mt-1">Account: {twilioTest.result.checks.account_name}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Integration */}
          {active === 'ai' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">AI Integration</h3>
              <p className="text-xs text-gray-400">Configure AI providers and feature toggles for the entire platform.</p>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Claude API Key (Anthropic)</label>
                <input type="password" value={ai.anthropic_key} onChange={e => setAi(p=>({...p,anthropic_key:e.target.value}))} placeholder="sk-ant-..."
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">OpenAI / ChatGPT Key</label>
                  <input type="password" value={ai.openai_key} onChange={e => setAi(p=>({...p,openai_key:e.target.value}))} placeholder="sk-..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
                <div><label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Gemini API Key</label>
                  <input type="password" value={ai.gemini_key} onChange={e => setAi(p=>({...p,gemini_key:e.target.value}))} placeholder="AI..."
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg font-mono focus:outline-none focus:ring-1 focus:ring-teal/30" /></div>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">AI Features</p>
                <div className="space-y-2">
                  {([
                    ['call_summaries', 'Call Summaries', 'Auto-generate summaries after calls end'],
                    ['smart_replies', 'Smart Replies', 'AI-suggested responses in messaging'],
                    ['sentiment', 'Sentiment Analysis', 'Track contact sentiment across interactions'],
                    ['task_gen', 'Auto Task Generation', 'Create follow-up tasks from call summaries'],
                  ] as const).map(([key, label, desc]) => (
                    <label key={key} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50/50 cursor-pointer">
                      <input type="checkbox" checked={(ai as any)[key]} onChange={e => setAi(p => ({ ...p, [key]: e.target.checked }))}
                        className="accent-teal w-3 h-3 mt-0.5" />
                      <div><p className="text-xs font-medium text-np-dark">{label}</p><p className="text-[10px] text-gray-400">{desc}</p></div>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Pipeline */}
          {active === 'pipeline' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Pipeline Stages</h3>
              <p className="text-xs text-gray-400">Comma-separated list of pipeline stages for your contacts.</p>
              <textarea value={pipeline.stages} onChange={e => setPipeline({ stages: e.target.value })} rows={3}
                className="w-full px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              <div className="flex flex-wrap gap-1">
                {pipeline.stages.split(',').filter(Boolean).map(s => (
                  <span key={s} className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-np-blue/8 text-np-blue">{s.trim()}</span>
                ))}
              </div>
            </div>
          )}

          {/* Team — Embedded */}
          {active === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-np-dark">Team Members</h3>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {currentOrg?.name} &middot; {members.length} members
                  </p>
                </div>
                {isAdmin && (
                  <button onClick={() => setAddingMember(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
                    <Plus size={12} /> Add Member
                  </button>
                )}
              </div>

              {/* Add Member Form */}
              {addingMember && (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <h4 className="text-xs font-semibold text-np-dark mb-3">Add Team Member</h4>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">Name *</label>
                      <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name"
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" autoFocus />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">Email</label>
                      <input value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="email@company.com"
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">Role</label>
                      <select value={newRole} onChange={e => setNewRole(e.target.value as any)}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                        {Object.entries(ROLE_CONFIG).map(([key, config]) => {
                          if (!isSuperAdmin && key === 'super_admin') return null
                          return <option key={key} value={key}>{config.label}</option>
                        })}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500 block mb-0.5">Job Title</label>
                      <input value={newTitle} onChange={e => setNewTitle(e.target.value)} placeholder="Role / Title"
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleAddMember} className="px-4 py-1.5 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark">Add</button>
                    <button onClick={() => { setAddingMember(false); setNewName(''); setNewEmail(''); setNewTitle('') }}
                      className="px-4 py-1.5 border border-gray-200 text-xs font-medium rounded-lg hover:bg-gray-50">Cancel</button>
                  </div>
                </div>
              )}

              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input value={teamSearch} onChange={e => setTeamSearch(e.target.value)} placeholder="Search team..."
                  className="w-full pl-9 pr-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
              </div>

              {/* Role Legend */}
              {isSuperAdmin && (
                <div className="flex gap-1.5 flex-wrap">
                  {Object.entries(ROLE_CONFIG).map(([key, config]) => {
                    const count = members.filter(m => m.role === key).length
                    if (count === 0) return null
                    return (
                      <span key={key} className="text-[9px] font-bold px-2 py-0.5 rounded-full"
                        style={{ backgroundColor: config.bg, color: config.color }}>
                        {config.label}: {count}
                      </span>
                    )
                  })}
                </div>
              )}

              {/* Active Members */}
              {teamLoading ? (
                <div className="text-center py-8 text-xs text-gray-400">Loading team...</div>
              ) : (
                <>
                  <div className="border border-gray-100 rounded-lg overflow-hidden">
                    <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                      <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Active ({activeMembers.length})</span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {activeMembers.map(member => {
                        const roleConfig = ROLE_CONFIG[member.role]
                        return (
                          <button key={member.id} onClick={() => setSelectedMember(member)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0"
                              style={{ backgroundColor: roleConfig.color }}>
                              {member.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-np-dark">{member.display_name}</span>
                                <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: roleConfig.bg, color: roleConfig.color }}>
                                  {roleConfig.label}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                {member.job_title && <span className="text-[10px] text-gray-500">{member.job_title}</span>}
                                {member.email && <span className="text-[10px] text-gray-400">{member.email}</span>}
                              </div>
                            </div>
                          </button>
                        )
                      })}
                      {activeMembers.length === 0 && (
                        <div className="px-3 py-6 text-center text-xs text-gray-400">No active members found</div>
                      )}
                    </div>
                  </div>

                  {/* Inactive/Invited */}
                  {otherMembers.length > 0 && (
                    <div className="border border-gray-100 rounded-lg overflow-hidden">
                      <div className="px-3 py-2 bg-gray-50 border-b border-gray-100">
                        <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Invited / Inactive ({otherMembers.length})</span>
                      </div>
                      <div className="divide-y divide-gray-50">
                        {otherMembers.map(member => (
                          <button key={member.id} onClick={() => setSelectedMember(member)}
                            className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left opacity-60">
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-white font-bold text-[10px] flex-shrink-0 bg-gray-400">
                              {member.display_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
                            </div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-np-dark">{member.display_name}</span>
                              <span className="text-[9px] ml-2 uppercase text-gray-400 font-medium">{member.status}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Member Detail Panel */}
              <MemberDetail
                member={selectedMember}
                onClose={() => setSelectedMember(null)}
                onUpdate={updateMember}
                onDelete={deleteMember}
                isSuperAdmin={isSuperAdmin}
                isAdmin={isAdmin}
                isOwnProfile={selectedMember?.user_id === user?.id || false}
                allOrgs={organizations}
              />
            </div>
          )}

          {/* Admin Tools — Link Cards */}
          {active === 'admin_tools' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-np-dark">Admin Tools</h3>
                <p className="text-xs text-gray-400 mt-1">Quick access to administration and monitoring dashboards.</p>
              </div>
              <div className="space-y-2">
                {([
                  { href: '/integrations', icon: Activity, label: 'Integrations', desc: 'Google, Slack, Twilio connections and OAuth setup' },
                  { href: '/activity-log', icon: History, label: 'Activity Log', desc: 'Real-time CRM activity feed with filters' },
                  { href: '/usage-analytics', icon: BarChart3, label: 'Usage Analytics', desc: 'Page views, team activity, API health, and sunset candidates' },
                  { href: '/auditor', icon: Shield, label: 'System Auditor', desc: 'System health score, data integrity, and repair tools' },
                ] as const).map(tool => (
                  <Link key={tool.href} href={tool.href}
                    className="flex items-center gap-3 px-4 py-3.5 rounded-lg border border-gray-100 hover:border-np-blue/20 hover:bg-np-blue/5 transition-colors group">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 group-hover:bg-np-blue/10 flex items-center justify-center flex-shrink-0 transition-colors">
                      <tool.icon size={16} className="text-gray-500 group-hover:text-np-blue transition-colors" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-np-dark">{tool.label}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{tool.desc}</p>
                    </div>
                    <ChevronRight size={14} className="text-gray-300 group-hover:text-np-blue transition-colors" />
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Notifications */}
          {active === 'notifications' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Notification Preferences</h3>
              <div className="space-y-2">
                {([
                  ['new_lead', 'New lead created'],
                  ['missed_call', 'Missed inbound call'],
                  ['task_overdue', 'Task past due date'],
                  ['campaign_complete', 'Campaign finished sending'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100 hover:bg-gray-50/50 cursor-pointer">
                    <input type="checkbox" checked={(notifications as any)[key]} onChange={e => setNotifications(p => ({ ...p, [key]: e.target.checked }))}
                      className="accent-teal w-3 h-3" />
                    <span className="text-xs text-np-dark">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Compliance */}
          {active === 'compliance' && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold text-np-dark">Compliance & Data</h3>
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100">
                <input type="checkbox" checked={compliance.double_optin} onChange={e => setCompliance(p=>({...p,double_optin:e.target.checked}))} className="accent-teal w-3 h-3" />
                <div><p className="text-xs font-medium text-np-dark">Double opt-in for email</p><p className="text-[10px] text-gray-400">Require confirmation before adding to email list</p></div>
              </label>
              <label className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-100">
                <input type="checkbox" checked={compliance.auto_dnc_unsubscribe} onChange={e => setCompliance(p=>({...p,auto_dnc_unsubscribe:e.target.checked}))} className="accent-teal w-3 h-3" />
                <div><p className="text-xs font-medium text-np-dark">Auto-DNC on unsubscribe</p><p className="text-[10px] text-gray-400">Automatically add to Do Not Contact list when someone unsubscribes</p></div>
              </label>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Data Retention (days)</label>
                <input type="number" value={compliance.retention_days} onChange={e => setCompliance(p=>({...p,retention_days:parseInt(e.target.value)||365}))}
                  className="w-32 mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg" />
              </div>
            </div>
          )}

          {/* Save Button — hidden for sections that don't need it */}
          {active !== 'team' && active !== 'admin_tools' && (
            <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-gray-100">
              {saved && <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium"><CheckCircle2 size={12} /> Saved</span>}
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
                <Save size={12} /> {saving ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
