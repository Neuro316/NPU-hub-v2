'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { useTeamData } from '@/lib/hooks/use-team-data'
import { MEETING_TEMPLATES } from '@/lib/types/meetings'
import type { MeetingTemplate } from '@/lib/types/meetings'
import {
  Brain, Users, Save, Loader2, Check, Sparkles, X, Plus, Target, Zap, Calendar, Settings
} from 'lucide-react'

const TMPL_ICONS: Record<string, any> = { level_10: Target, one_on_one: Users, standup: Zap, quarterly: Calendar, custom: Sparkles }

interface MeetingAiConfig {
  instructions: string
  persona: string
  focus_areas: string[]
  critical_lens: 'conservative' | 'balanced' | 'aggressive'
}

interface MeetingRoster {
  [templateKey: string]: string[] // template → array of user_ids
}

export default function MeetingSettings() {
  const { currentOrg } = useWorkspace()
  const { members } = useTeamData()
  const supabase = createClient()

  const [aiConfig, setAiConfig] = useState<MeetingAiConfig>({
    instructions: '', persona: 'Strategic Advisor', focus_areas: [], critical_lens: 'balanced',
  })
  const [roster, setRoster] = useState<MeetingRoster>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newFocus, setNewFocus] = useState('')

  const load = useCallback(async () => {
    if (!currentOrg) return; setLoading(true)
    const { data } = await supabase.from('org_settings').select('setting_key, setting_value').eq('org_id', currentOrg.id).in('setting_key', ['meeting_ai_instructions', 'meeting_team_roster'])
    if (data) {
      const ai = data.find(d => d.setting_key === 'meeting_ai_instructions')
      if (ai?.setting_value) setAiConfig({ instructions: ai.setting_value.instructions || '', persona: ai.setting_value.persona || 'Strategic Advisor', focus_areas: ai.setting_value.focus_areas || [], critical_lens: ai.setting_value.critical_lens || 'balanced' })
      const r = data.find(d => d.setting_key === 'meeting_team_roster')
      if (r?.setting_value) setRoster(r.setting_value)
    }
    setLoading(false)
  }, [currentOrg?.id])
  useEffect(() => { load() }, [load])

  const saveAll = async () => {
    if (!currentOrg) return; setSaving(true)
    // Save AI instructions
    await supabase.from('org_settings').upsert({ org_id: currentOrg.id, setting_key: 'meeting_ai_instructions', setting_value: aiConfig }, { onConflict: 'org_id,setting_key' })
    // Save team roster
    await supabase.from('org_settings').upsert({ org_id: currentOrg.id, setting_key: 'meeting_team_roster', setting_value: roster }, { onConflict: 'org_id,setting_key' })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const toggleRoster = (tmpl: string, userId: string) => {
    setRoster(prev => {
      const current = prev[tmpl] || []
      return { ...prev, [tmpl]: current.includes(userId) ? current.filter(id => id !== userId) : [...current, userId] }
    })
  }

  const addFocus = () => { if (!newFocus.trim()) return; setAiConfig(p => ({ ...p, focus_areas: [...p.focus_areas, newFocus.trim()] })); setNewFocus('') }
  const rmFocus = (i: number) => setAiConfig(p => ({ ...p, focus_areas: p.focus_areas.filter((_, j) => j !== i) }))

  if (loading) return <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-np-blue" /></div>

  return (
    <div className="space-y-6">
      {/* ═══ AI AGENT INSTRUCTIONS ═══ */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Brain size={14} className="text-violet-500" />
          <h3 className="text-sm font-bold text-np-dark">AI Meeting Agent</h3>
          <span className="text-[10px] text-gray-400 ml-1">Configure how AI analyzes issues and fills IDS</span>
        </div>
        <div className="p-5 space-y-4">
          {/* Persona */}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">AI Persona</label>
            <select value={aiConfig.persona} onChange={e => setAiConfig(p => ({ ...p, persona: e.target.value }))}
              className="w-full mt-1 px-3 py-2.5 text-xs border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-violet-200">
              <option value="Strategic Advisor">Strategic Advisor — Critical & strategic, cross-references everything</option>
              <option value="Operations Manager">Operations Manager — Focused on execution, timelines, bottlenecks</option>
              <option value="Growth Strategist">Growth Strategist — Revenue-focused, opportunity-seeking</option>
              <option value="Risk Analyst">Risk Analyst — Conservative, identifies threats & dependencies</option>
              <option value="Innovation Coach">Innovation Coach — Creative solutions, challenges assumptions</option>
            </select>
          </div>

          {/* Critical Lens */}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Analysis Intensity</label>
            <div className="flex gap-2 mt-1.5">
              {(['conservative', 'balanced', 'aggressive'] as const).map(level => (
                <button key={level} onClick={() => setAiConfig(p => ({ ...p, critical_lens: level }))}
                  className={`flex-1 py-2.5 rounded-xl text-[11px] font-semibold border-2 transition-all ${aiConfig.critical_lens === level ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-100 text-gray-400 hover:border-gray-200'}`}>
                  {level === 'conservative' && '🛡️ Conservative'}
                  {level === 'balanced' && '⚖️ Balanced'}
                  {level === 'aggressive' && '🔥 Aggressive'}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-gray-400 mt-1">
              {aiConfig.critical_lens === 'conservative' && 'Cautious analysis. Highlights risks and dependencies. Recommends validation before action.'}
              {aiConfig.critical_lens === 'balanced' && 'Balanced perspective. Weighs risks vs opportunities. Practical recommendations.'}
              {aiConfig.critical_lens === 'aggressive' && 'Bias toward action. Challenges status quo. Pushes for bold moves and speed.'}
            </p>
          </div>

          {/* Focus Areas */}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Focus Areas <span className="normal-case text-gray-300">— AI will prioritize these in analysis</span></label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {aiConfig.focus_areas.map((f, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 bg-violet-50 text-violet-700 text-[10px] font-medium rounded-lg">
                  {f} <button onClick={() => rmFocus(i)} className="text-violet-400 hover:text-violet-600"><X size={9} /></button>
                </span>
              ))}
              <div className="inline-flex items-center gap-1">
                <input value={newFocus} onChange={e => setNewFocus(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addFocus() }}
                  placeholder="Add focus area..." className="px-2 py-1 text-[10px] border border-gray-200 rounded-lg w-32 focus:outline-none focus:ring-1 focus:ring-violet-200" />
                <button onClick={addFocus} className="text-violet-400 hover:text-violet-600"><Plus size={12} /></button>
              </div>
            </div>
          </div>

          {/* Custom Instructions */}
          <div>
            <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Custom Instructions</label>
            <textarea value={aiConfig.instructions} onChange={e => setAiConfig(p => ({ ...p, instructions: e.target.value }))}
              placeholder={"Give the AI agent specific guidance for your meetings...\n\nExamples:\n• Always check if an IDS issue overlaps with an existing rock or task before creating new work\n• Push back on scope creep — challenge whether new initiatives align with Q1 rocks\n• When revenue is involved, always calculate impact on breakeven target of 64 participants/month\n• Reference the competitor landscape when analyzing market positioning issues\n• Flag any issue that could affect the paid cohort launch timeline"}
              rows={6} className="w-full mt-1 px-4 py-3 text-xs border border-gray-200 rounded-xl bg-gray-50/50 focus:outline-none focus:ring-2 focus:ring-violet-200 resize-none placeholder-gray-400" />
          </div>
        </div>
      </div>

      {/* ═══ TEAM ROSTER PER MEETING TYPE ═══ */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center gap-2">
          <Users size={14} className="text-np-blue" />
          <h3 className="text-sm font-bold text-np-dark">Default Attendees by Meeting Type</h3>
          <span className="text-[10px] text-gray-400 ml-1">Pre-select who joins each type</span>
        </div>
        <div className="p-5 space-y-4">
          {(Object.entries(MEETING_TEMPLATES) as [MeetingTemplate, typeof MEETING_TEMPLATES.custom][]).map(([key, cfg]) => {
            const Icon = TMPL_ICONS[key] || Settings
            const selectedIds = roster[key] || []
            return (
              <div key={key} className="border border-gray-100 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: cfg.color + '15' }}>
                    <Icon size={13} style={{ color: cfg.color }} />
                  </div>
                  <span className="text-xs font-bold text-np-dark">{cfg.label}</span>
                  <span className="text-[10px] text-gray-400">{selectedIds.length} member{selectedIds.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {members.filter(m => m.user_id).map(m => {
                    const uid = m.user_id as string; const sel = selectedIds.includes(uid)
                    const init = (m.display_name || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
                    return (
                      <button key={uid} onClick={() => toggleRoster(key, uid)}
                        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-medium border transition-all ${sel ? 'bg-np-blue/5 text-np-dark border-np-blue/30 shadow-sm' : 'bg-white text-gray-400 border-gray-100 hover:border-gray-200'}`}>
                        <div className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold" style={{ background: sel ? cfg.color + '20' : '#F3F4F6', color: sel ? cfg.color : '#9CA3AF' }}>{init}</div>
                        {m.display_name?.split(' ')[0]}
                        {sel && <Check size={10} className="text-np-blue" />}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={saveAll} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-np-blue text-white text-xs font-semibold rounded-xl hover:bg-np-dark disabled:opacity-50 shadow-sm transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : <Save size={12} />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  )
}
