'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Campaigns — Email campaign builder
// Route: /crm/campaigns
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import {
  Plus, Mail, Send, Pause, Play, Eye, Copy, BarChart3,
  Users, Clock, CheckCircle2, AlertTriangle, Search
} from 'lucide-react'
import { fetchCampaigns, createCampaign } from '@/lib/crm-client'
import type { EmailCampaign, CampaignStatus } from '@/types/crm'

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
  const openRate = campaign.total_recipients && campaign.sent_count > 0
    ? Math.round((campaign.sent_count / campaign.total_recipients) * 100)
    : null

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 hover:shadow-md hover:border-np-blue/20 transition-all cursor-pointer">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-semibold text-np-dark truncate">{campaign.name}</h4>
          <p className="text-[10px] text-gray-400 mt-0.5 truncate">{campaign.subject}</p>
        </div>
        <span
          className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold flex-shrink-0"
          style={{ color: config.color, background: config.bg }}
        >
          <Icon size={10} /> {config.label}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded-lg bg-gray-50/50">
          <p className="text-lg font-bold text-np-dark">{campaign.total_recipients || 0}</p>
          <p className="text-[9px] text-gray-400">Recipients</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-gray-50/50">
          <p className="text-lg font-bold text-np-dark">{campaign.sent_count}</p>
          <p className="text-[9px] text-gray-400">Sent</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-gray-50/50">
          <p className="text-lg font-bold text-np-dark">{campaign.failed_count}</p>
          <p className="text-[9px] text-gray-400">Failed</p>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100/50">
        <span className="text-[10px] text-gray-400">
          {campaign.created_at ? new Date(campaign.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
        </span>
        <div className="flex gap-1">
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Preview">
            <Eye size={12} className="text-gray-400" />
          </button>
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Duplicate">
            <Copy size={12} className="text-gray-400" />
          </button>
          <button className="p-1 rounded hover:bg-gray-50 transition-colors" title="Stats">
            <BarChart3 size={12} className="text-gray-400" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newCampaign, setNewCampaign] = useState({ name: '', subject: '', body_html: '' })

  useEffect(() => {
    fetchCampaigns().then(setCampaigns).catch(console.error).finally(() => setLoading(false))
  }, [])

  const filtered = campaigns.filter(c => {
    if (statusFilter && c.status !== statusFilter) return false
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) && !c.subject.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const handleCreate = async () => {
    if (!newCampaign.name || !newCampaign.subject) return
    try {
      const created = await createCampaign({
        ...newCampaign,
        status: 'draft',
        sent_count: 0,
        failed_count: 0,
      })
      setCampaigns(prev => [created, ...prev])
      setShowCreate(false)
      setNewCampaign({ name: '', subject: '', body_html: '' })
    } catch (e) {
      console.error(e)
    }
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search campaigns..."
            className="w-full pl-8 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
          />
        </div>
        <div className="flex gap-1">
          {['', 'draft', 'sending', 'completed', 'scheduled'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2 py-1.5 text-[10px] font-medium rounded-md transition-all ${
                statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-50 text-gray-400 hover:text-gray-600'
              }`}
            >
              {s || 'All'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors"
        >
          <Plus size={13} /> New Campaign
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex gap-3">
        {(['draft', 'sending', 'completed'] as CampaignStatus[]).map(s => {
          const count = campaigns.filter(c => c.status === s).length
          const cfg = STATUS_CONFIG[s]
          return (
            <div key={s} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-100 bg-white">
              <cfg.icon size={12} style={{ color: cfg.color }} />
              <span className="text-xs font-medium text-gray-600">{cfg.label}</span>
              <span className="text-xs font-bold text-np-dark">{count}</span>
            </div>
          )
        })}
      </div>

      {/* Campaign Grid */}
      {loading ? (
        <div className="text-center py-12 text-xs text-gray-400">Loading campaigns...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(c => <CampaignCard key={c.id} campaign={c} />)}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12">
              <Mail size={32} className="mx-auto text-gray-400/30 mb-3" />
              <p className="text-sm text-gray-400">No campaigns found</p>
            </div>
          )}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-100 p-5 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-np-dark mb-4">New Email Campaign</h3>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Campaign Name</label>
                <input
                  value={newCampaign.name}
                  onChange={e => setNewCampaign(p => ({ ...p, name: e.target.value }))}
                  placeholder="Q1 Mastermind Outreach"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Subject Line</label>
                <input
                  value={newCampaign.subject}
                  onChange={e => setNewCampaign(p => ({ ...p, subject: e.target.value }))}
                  placeholder="Your nervous system is ready for more"
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30"
                />
              </div>
              <div>
                <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Body (HTML)</label>
                <textarea
                  value={newCampaign.body_html}
                  onChange={e => setNewCampaign(p => ({ ...p, body_html: e.target.value }))}
                  placeholder="<p>Hi {{first_name}},</p>"
                  rows={6}
                  className="w-full mt-1 px-3 py-2 text-xs border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 font-mono"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowCreate(false)} className="px-3 py-2 text-xs text-gray-400 hover:text-np-dark transition-colors">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newCampaign.name || !newCampaign.subject}
                className="px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40 transition-colors"
              >
                Create Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
