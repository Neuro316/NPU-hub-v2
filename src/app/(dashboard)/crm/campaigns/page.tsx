'use client'

import { useEffect, useState } from 'react'
import {
  Plus, Mail, Send, Pause, Clock, CheckCircle2, AlertTriangle,
  Search, Eye, Copy, BarChart3, MessageCircle, Calendar
} from 'lucide-react'
import { fetchCampaigns, createCampaign } from '@/lib/crm-client'
import type { EmailCampaign, CampaignStatus } from '@/types/crm'
import { useWorkspace } from '@/lib/workspace-context'

const STATUS_CONFIG: Record<CampaignStatus, { label: string; color: string; bg: string; icon: any }> = {
  draft: { label: 'Draft', color: '#6b7280', bg: '#f3f4f6', icon: Mail },
  scheduled: { label: 'Scheduled', color: '#2563eb', bg: '#eff6ff', icon: Clock },
  sending: { label: 'Sending', color: '#d97706', bg: '#fffbeb', icon: Send },
  paused: { label: 'Paused', color: '#9333ea', bg: '#faf5ff', icon: Pause },
  completed: { label: 'Completed', color: '#059669', bg: '#ecfdf5', icon: CheckCircle2 },
  failed: { label: 'Failed', color: '#dc2626', bg: '#fef2f2', icon: AlertTriangle },
}

function CampaignCard({ campaign }: { campaign: EmailCampaign }) {
  const config = STATUS_CONFIG[campaign.status]
  const Icon = config.icon
  const channel = (campaign.filter_criteria as any)?.channel || 'email'
  const ChannelIcon = channel === 'sms' ? MessageCircle : Mail

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-np-blue/20 transition-all cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${channel === 'sms' ? 'bg-green-50 text-green-500' : 'bg-blue-50 text-blue-500'}`}>
            <ChannelIcon size={14} />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-np-dark truncate">{campaign.name}</h4>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">{campaign.subject}</p>
          </div>
        </div>
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
          style={{ color: config.color, background: config.bg }}>
          <Icon size={10} /> {config.label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-gray-50/50"><p className="text-lg font-bold text-np-dark">{campaign.total_recipients || 0}</p><p className="text-[9px] text-gray-400">Recipients</p></div>
        <div className="text-center p-2 rounded-lg bg-gray-50/50"><p className="text-lg font-bold text-np-dark">{campaign.sent_count}</p><p className="text-[9px] text-gray-400">Sent</p></div>
        <div className="text-center p-2 rounded-lg bg-gray-50/50"><p className="text-lg font-bold text-np-dark">{campaign.failed_count}</p><p className="text-[9px] text-gray-400">Failed</p></div>
      </div>
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100/50">
        <span className="text-[10px] text-gray-400">{campaign.created_at ? new Date(campaign.created_at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : ''}</span>
        <div className="flex gap-1">
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Preview"><Eye size={12} className="text-gray-400" /></button>
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Duplicate"><Copy size={12} className="text-gray-400" /></button>
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Stats"><BarChart3 size={12} className="text-gray-400" /></button>
        </div>
      </div>
    </div>
  )
}

const EMPTY = { name: '', subject: '', body_html: '', channel: 'email' as 'email' | 'sms', scheduled_at: '' }

export default function CampaignsPage() {
  const { currentOrg, user } = useWorkspace()
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({
    name: '', subject: '', body_html: '', channel: 'email' as 'email' | 'sms',
    scheduled_at: '',
  })

  useEffect(() => {
    fetchCampaigns().then(setCampaigns).catch(console.error).finally(() => setLoading(false))
  }, [])

  const filtered = campaigns.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.subject.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleCreate = async () => {
    if (!form.name || !currentOrg) return
    if (form.channel === 'email' && !form.subject) return
    setCreating(true)
    try {
      const created = await createCampaign({
        org_id: currentOrg.id,
        name: form.name,
        subject: form.channel === 'email' ? form.subject : form.name,
        body_html: form.body_html,
        status: 'draft',
        sent_count: 0,
        failed_count: 0,
        created_by: user?.id,
        filter_criteria: { channel: form.channel },
        scheduled_at: form.scheduled_at || undefined,
      })
      setCampaigns(prev => [created, ...prev])
      setShowCreate(false)
      setForm({ name: '', subject: '', body_html: '', channel: 'email', scheduled_at: '' })
    } catch (e) { console.error(e); alert('Failed to create campaign') }
    finally { setCreating(false) }
  }

  const smsCharCount = form.body_html.length
  const smsSegments = Math.ceil(smsCharCount / 160) || 0

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search campaigns..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
        </div>
        <div className="flex gap-1">
          {['','draft','sending','completed','scheduled'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${statusFilter===s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'}`}>
              {s || 'All'}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors">
          <Plus size={13} /> New Campaign
        </button>
      </div>

      {/* Campaign Grid */}
      {loading ? <div className="text-center py-12 text-xs text-gray-400">Loading campaigns...</div> : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => <CampaignCard key={c.id} campaign={c} />)}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12"><Mail size={32} className="mx-auto text-gray-400/30 mb-3" /><p className="text-sm text-gray-400">No campaigns found</p></div>
          )}
        </div>
      )}

      {/* ── Create Campaign Modal ── */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold text-np-dark">New Campaign</h3>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-50"><MessageCircle size={14} /></button>
            </div>

            {/* Channel Toggle */}
            <div className="flex gap-1 mb-4 p-1 bg-gray-50 rounded-lg">
              {(['email','sms'] as const).map(ch => (
                <button key={ch} onClick={() => setForm(p => ({ ...p, channel: ch }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-all ${
                    form.channel === ch ? 'bg-white shadow-sm text-np-dark' : 'text-gray-400 hover:text-gray-600'
                  }`}>
                  {ch === 'email' ? <Mail size={12} /> : <MessageCircle size={12} />}
                  {ch === 'email' ? 'Email' : 'SMS'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {/* Channel Toggle */}
              <div>
                <label className="text-[10px] font-semibold uppercase text-gray-400">Channel</label>
                <div className="flex gap-2 mt-1">
                  <button onClick={() => setForm(p => ({ ...p, channel: 'email' }))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-xs font-medium transition-all ${form.channel === 'email' ? 'border-np-blue bg-np-blue/5 text-np-blue' : 'border-gray-100 text-gray-400 hover:border-gray-200'}`}>
                    <Mail size={14} /> Email
                  </button>
                  <button onClick={() => setForm(p => ({ ...p, channel: 'sms' }))} className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border-2 text-xs font-medium transition-all ${form.channel === 'sms' ? 'border-green-500 bg-green-50 text-green-600' : 'border-gray-100 text-gray-400 hover:border-gray-200'}`}>
                    <MessageCircle size={14} /> SMS
                  </button>
                </div>
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase text-gray-400">Campaign Name *</label>
                <input value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="Q1 Mastermind Outreach" className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Campaign Name *</label>
                <input value={form.name} onChange={e => setForm(p=>({...p,name:e.target.value}))} placeholder="Q1 Mastermind Outreach"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>

              {form.channel === 'email' && (
                <div>
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject Line *</label>
                  <input value={form.subject} onChange={e => setForm(p=>({...p,subject:e.target.value}))} placeholder="Your nervous system is ready for more"
                    className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                </div>
              )}

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {form.channel === 'email' ? 'Body (HTML)' : 'Message Body'}
                </label>
                <textarea value={form.body_html} onChange={e => setForm(p=>({...p,body_html:e.target.value}))}
                  placeholder={form.channel === 'email' ? '<p>Hi {{first_name}},</p>' : 'Hi {{first_name}}, ...'}
                  rows={form.channel === 'email' ? 6 : 3}
                  className={`w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 ${form.channel === 'email' ? 'font-mono' : ''}`} />
                {form.channel === 'sms' && (
                  <p className="text-[9px] text-gray-400 mt-1">
                    {smsCharCount} characters / {smsSegments} segment{smsSegments !== 1 ? 's' : ''} (160 per segment)
                  </p>
                )}
              </div>

              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1">
                  <Calendar size={9} /> Schedule (optional)
                </label>
                <input type="datetime-local" value={form.scheduled_at} onChange={e => setForm(p=>({...p,scheduled_at:e.target.value}))}
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-gray-400 hover:text-np-dark">Cancel</button>
              <button onClick={handleCreate}
                disabled={!form.name || (form.channel === 'email' && !form.subject) || creating}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors">
                {creating ? 'Creating...' : 'Save Draft'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
