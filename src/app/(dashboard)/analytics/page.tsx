'use client'

import { useWorkspace } from '@/lib/workspace-context'
import { BarChart3, TrendingUp, Target, Users, Zap, Brain, ArrowUpRight, ArrowDownRight } from 'lucide-react'

export default function AnalyticsPage() {
  const { currentOrg, loading } = useWorkspace()

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading analytics...</div></div>
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Analytics</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · Marketing Intelligence</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total Reach', value: '—', change: null, icon: Users, color: '#3B82F6' },
          { label: 'Engagement Rate', value: '—', change: null, icon: TrendingUp, color: '#10B981' },
          { label: 'Lead Conversions', value: '—', change: null, icon: Target, color: '#F59E0B' },
          { label: 'Campaign ROI', value: '—', change: null, icon: Zap, color: '#8B5CF6' },
        ].map((kpi, i) => (
          <div key={i} className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
              {kpi.change !== null && (
                <span className={`text-[9px] font-bold flex items-center gap-0.5 ${(kpi.change as number) > 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {(kpi.change as number) > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {Math.abs(kpi.change as number)}%
                </span>
              )}
            </div>
            <p className="text-lg font-bold text-np-dark">{kpi.value}</p>
            <p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">{kpi.label}</p>
          </div>
        ))}
      </div>

      {/* Bayesian Campaign Stack */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Brain className="w-5 h-5 text-np-blue" />
          <h2 className="text-sm font-bold text-np-dark">Bayesian Campaign Stack Ranking</h2>
          <span className="text-[9px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium">Intelligence Engine</span>
        </div>
        <p className="text-xs text-gray-500 mb-6">
          As campaigns collect data, the Bayesian engine ranks your best-performing combinations of quiz type + post format + platform + ICP target.
          Early campaigns use neutral priors; rankings sharpen as sample sizes grow.
        </p>

        {/* Placeholder ranking table */}
        <div className="bg-gray-50 rounded-xl p-8 text-center">
          <BarChart3 className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-400 mb-1">Campaign data needed</p>
          <p className="text-xs text-gray-400">Create campaigns and publish social posts to start building your ranking stack.</p>
        </div>
      </div>

      {/* Performance by Platform */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-np-dark mb-3">Performance by Platform</h3>
          <div className="space-y-3">
            {[
              { platform: 'Instagram', icon: '📸', color: '#E4405F' },
              { platform: 'LinkedIn', icon: '💼', color: '#0A66C2' },
              { platform: 'Facebook', icon: '📘', color: '#1877F2' },
              { platform: 'TikTok', icon: '🎵', color: '#000000' },
              { platform: 'X', icon: '𝕏', color: '#1DA1F2' },
            ].map(p => (
              <div key={p.platform} className="flex items-center gap-3">
                <span className="text-sm w-6">{p.icon}</span>
                <span className="text-xs text-np-dark w-20">{p.platform}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full opacity-30" style={{ backgroundColor: p.color, width: '0%' }} />
                </div>
                <span className="text-[9px] text-gray-400 w-12 text-right">No data</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-np-dark mb-3">Content Format Performance</h3>
          <div className="space-y-3">
            {['Square Post', 'Portrait Post', 'Story/Reel', 'Carousel', 'Article'].map(format => (
              <div key={format} className="flex items-center gap-3">
                <span className="text-xs text-np-dark w-28">{format}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                  <div className="h-full rounded-full bg-np-blue/30" style={{ width: '0%' }} />
                </div>
                <span className="text-[9px] text-gray-400 w-12 text-right">No data</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Conversion Funnel */}
      <div className="bg-white border border-gray-100 rounded-xl p-5">
        <h3 className="text-xs font-bold text-np-dark mb-4">Conversion Funnel</h3>
        <div className="flex items-end justify-center gap-4 h-48">
          {[
            { label: 'Impressions', value: 0, height: '100%', color: '#DBEAFE' },
            { label: 'Clicks', value: 0, height: '70%', color: '#93C5FD' },
            { label: 'Quiz Starts', value: 0, height: '45%', color: '#60A5FA' },
            { label: 'Quiz Complete', value: 0, height: '30%', color: '#3B82F6' },
            { label: 'Email Capture', value: 0, height: '20%', color: '#2563EB' },
            { label: 'Discovery Call', value: 0, height: '10%', color: '#1D4ED8' },
            { label: 'Enrollment', value: 0, height: '5%', color: '#1E40AF' },
          ].map((step, i) => (
            <div key={i} className="flex flex-col items-center gap-1 flex-1">
              <div className="w-full rounded-t-lg" style={{ height: step.height, backgroundColor: step.color, minHeight: 8, opacity: 0.3 }} />
              <span className="text-[8px] text-gray-500 font-medium text-center">{step.label}</span>
              <span className="text-[10px] font-bold text-gray-400">{step.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
