'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { Plus, Wand2, Target, TrendingUp, Calendar, DollarSign, BarChart3, Zap } from 'lucide-react'

interface Campaign {
  id: string
  org_id: string
  brand: string
  name: string
  description: string | null
  status: string
  budget: number | null
  start_date: string | null
  end_date: string | null
  goals: Record<string, any>
  custom_fields: Record<string, any>
  created_at: string
}

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  draft: { label: 'Draft', color: '#9CA3AF', bg: '#F3F4F6' },
  active: { label: 'Active', color: '#10B981', bg: '#D1FAE5' },
  paused: { label: 'Paused', color: '#F59E0B', bg: '#FEF3C7' },
  completed: { label: 'Completed', color: '#3B82F6', bg: '#DBEAFE' },
  archived: { label: 'Archived', color: '#6B7280', bg: '#E5E7EB' },
}

export default function CampaignsPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [brand, setBrand] = useState('np')
  const [budget, setBudget] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const supabase = createClient()

  const fetchData = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const { data } = await supabase.from('campaigns').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false })
    if (data) setCampaigns(data)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchData() }, [fetchData])

  const handleCreate = async () => {
    if (!name.trim() || !currentOrg) return
    const { data, error } = await supabase.from('campaigns').insert({
      org_id: currentOrg.id, brand, name: name.trim(),
      description: description.trim() || null,
      budget: budget ? parseFloat(budget) : null,
      start_date: startDate || null, end_date: endDate || null,
      status: 'draft',
    }).select().single()
    if (data && !error) setCampaigns(prev => [data, ...prev])
    setName(''); setDescription(''); setBudget(''); setStartDate(''); setEndDate('')
    setCreating(false)
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading campaigns...</div></div>
  }

  const activeCampaigns = campaigns.filter(c => c.status === 'active')
  const totalBudget = activeCampaigns.reduce((sum, c) => sum + (c.budget || 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Campaigns</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {campaigns.length} campaigns · {activeCampaigns.length} active</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
            <Plus className="w-3.5 h-3.5" /> New Campaign
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Wand2 className="w-3.5 h-3.5" /> AI Campaign Creator
          </button>
        </div>
      </div>

      {/* Stats Row */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            { label: 'Total Campaigns', value: campaigns.length, icon: Target, color: '#386797' },
            { label: 'Active Now', value: activeCampaigns.length, icon: Zap, color: '#10B981' },
            { label: 'Total Budget', value: '$' + totalBudget.toLocaleString(), icon: DollarSign, color: '#F59E0B' },
            { label: 'Avg Performance', value: 'Coming Soon', icon: TrendingUp, color: '#8B5CF6' },
          ].map((stat, i) => (
            <div key={i} className="bg-white border border-gray-100 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">{stat.label}</span>
              </div>
              <p className="text-lg font-bold text-np-dark">{stat.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Create Form */}
      {creating && (
        <div className="mb-6 bg-white border border-gray-200 rounded-2xl p-6">
          <h3 className="text-sm font-bold text-np-dark mb-4">New Campaign</h3>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 block mb-0.5">Campaign Name *</label>
              <input value={name} onChange={e => setName(e.target.value)} placeholder="Q1 High-Performer Acquisition"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
            </div>
            <div className="col-span-2">
              <label className="text-[10px] text-gray-500 block mb-0.5">Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Campaign goals and strategy..."
                rows={2} className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 resize-none" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Brand</label>
              <div className="flex gap-1.5">
                {[{ k: 'np', l: 'Neuro Progeny' }, { k: 'sensorium', l: 'Sensorium' }].map(b => (
                  <button key={b.k} onClick={() => setBrand(b.k)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${brand === b.k ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                    {b.l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">Budget</label>
              <input type="number" value={budget} onChange={e => setBudget(e.target.value)} placeholder="2000"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 flex items-center gap-1 mb-0.5"><Calendar className="w-3 h-3" /> Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
            <div>
              <label className="text-[10px] text-gray-500 block mb-0.5">End Date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs py-2 px-4">Create Campaign</button>
            <button onClick={() => setCreating(false)} className="btn-secondary text-xs py-2 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Empty State */}
      {campaigns.length === 0 && !creating && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Target className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Campaign Designer</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Build campaigns that connect your quizzes, social posts, and email sequences. Track performance with Bayesian ranking to find your winning formula.
          </p>
          <button onClick={() => setCreating(true)} className="btn-primary">Create First Campaign</button>
        </div>
      )}

      {/* Campaign Cards */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {campaigns.map(campaign => {
            const statusConf = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.draft
            return (
              <div key={campaign.id}
                className="bg-white border border-gray-100 rounded-xl p-5 hover:shadow-md hover:border-gray-200 transition-all cursor-pointer">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: statusConf.bg, color: statusConf.color }}>
                    {statusConf.label}
                  </span>
                  <span className="text-[8px] font-bold uppercase text-gray-400">
                    {campaign.brand === 'np' ? 'Neuro Progeny' : 'Sensorium'}
                  </span>
                </div>
                <h3 className="text-sm font-bold text-np-dark mb-1">{campaign.name}</h3>
                {campaign.description && (
                  <p className="text-[10px] text-gray-500 line-clamp-2 mb-3">{campaign.description}</p>
                )}
                <div className="flex items-center gap-3 text-[9px] text-gray-400">
                  {campaign.budget && (
                    <span className="flex items-center gap-0.5"><DollarSign className="w-3 h-3" />{campaign.budget.toLocaleString()}</span>
                  )}
                  {campaign.start_date && (
                    <span className="flex items-center gap-0.5">
                      <Calendar className="w-3 h-3" />
                      {new Date(campaign.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {campaign.end_date && (' - ' + new Date(campaign.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
