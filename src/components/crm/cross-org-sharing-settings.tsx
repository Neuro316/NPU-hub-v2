'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import { ArrowRight, Check, Loader2, Plus, Save, Shield, Tag, Trash2, X } from 'lucide-react'

interface SharingRule {
  org_id: string
  org_name: string
  tags: string[]
  enabled: boolean
}

interface SharingConfig {
  receive_from: SharingRule[]
}

export default function CrossOrgSharingSettings() {
  const { currentOrg, organizations } = useWorkspace()
  const sb = createClient()

  const [config, setConfig] = useState<SharingConfig>({ receive_from: [] })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newTag, setNewTag] = useState<Record<string, string>>({})

  const otherOrgs = organizations.filter(o => o.id !== currentOrg?.id)

  const load = useCallback(async () => {
    if (!currentOrg) return; setLoading(true)
    const { data } = await sb.from('org_settings').select('setting_value')
      .eq('org_id', currentOrg.id).eq('setting_key', 'cross_org_contact_sharing').maybeSingle()
    if (data?.setting_value) setConfig(data.setting_value)
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  const saveConfig = async () => {
    if (!currentOrg) return; setSaving(true)
    await sb.from('org_settings').upsert({
      org_id: currentOrg.id,
      setting_key: 'cross_org_contact_sharing',
      setting_value: config,
    }, { onConflict: 'org_id,setting_key' })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const addRule = (orgId: string, orgName: string) => {
    if (config.receive_from.some(r => r.org_id === orgId)) return
    setConfig(prev => ({
      ...prev,
      receive_from: [...prev.receive_from, { org_id: orgId, org_name: orgName, tags: [], enabled: true }],
    }))
  }

  const removeRule = (orgId: string) => {
    setConfig(prev => ({ ...prev, receive_from: prev.receive_from.filter(r => r.org_id !== orgId) }))
  }

  const toggleRule = (orgId: string) => {
    setConfig(prev => ({
      ...prev,
      receive_from: prev.receive_from.map(r => r.org_id === orgId ? { ...r, enabled: !r.enabled } : r),
    }))
  }

  const addTag = (orgId: string) => {
    const tag = (newTag[orgId] || '').trim()
    if (!tag) return
    setConfig(prev => ({
      ...prev,
      receive_from: prev.receive_from.map(r =>
        r.org_id === orgId && !r.tags.some(t => t.toLowerCase() === tag.toLowerCase())
          ? { ...r, tags: [...r.tags, tag] } : r
      ),
    }))
    setNewTag(prev => ({ ...prev, [orgId]: '' }))
  }

  const removeTag = (orgId: string, tag: string) => {
    setConfig(prev => ({
      ...prev,
      receive_from: prev.receive_from.map(r =>
        r.org_id === orgId ? { ...r, tags: r.tags.filter(t => t !== tag) } : r
      ),
    }))
  }

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-np-blue" /></div>

  const unlinkedOrgs = otherOrgs.filter(o => !config.receive_from.some(r => r.org_id === o.id))

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 p-4 bg-blue-50/50 rounded-xl border border-blue-100">
        <Shield size={14} className="text-blue-500 mt-0.5 shrink-0" />
        <div className="text-[11px] text-blue-700 leading-relaxed">
          <strong>Cross-org contact sharing</strong> lets you see contacts from your other organizations
          when they match specific tags. Contacts appear read-only with a source badge.
          Sharing is one-directional — configure it only on the receiving org.
        </div>
      </div>

      {/* Existing rules */}
      {config.receive_from.map(rule => (
        <div key={rule.org_id} className={`border rounded-xl overflow-hidden transition-all ${rule.enabled ? 'border-green-200 bg-white' : 'border-gray-200 bg-gray-50 opacity-70'}`}>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
            <button onClick={() => toggleRule(rule.org_id)}
              className={`w-9 h-5 rounded-full relative transition-colors ${rule.enabled ? 'bg-green-500' : 'bg-gray-300'}`}>
              <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${rule.enabled ? 'left-[18px]' : 'left-0.5'}`} />
            </button>
            <div className="flex-1">
              <span className="text-xs font-bold text-np-dark">{rule.org_name}</span>
              <span className="text-[10px] text-gray-400 ml-2">→ visible in {currentOrg?.name}</span>
            </div>
            <span className="text-[9px] text-gray-400 font-medium">{rule.tags.length} tag{rule.tags.length !== 1 ? 's' : ''}</span>
            <button onClick={() => removeRule(rule.org_id)} className="text-gray-300 hover:text-red-400 p-1"><Trash2 size={12} /></button>
          </div>

          <div className="px-4 py-3 space-y-3">
            <div>
              <label className="text-[9px] font-bold text-gray-500 uppercase tracking-wider flex items-center gap-1">
                <Tag size={9} /> Matching Tags <span className="normal-case text-gray-300">— contacts with ANY of these tags will be shared</span>
              </label>
              <div className="flex flex-wrap gap-1.5 mt-2">
                {rule.tags.map(tag => (
                  <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-teal-50 text-teal-700 text-[10px] font-semibold rounded-lg border border-teal-200">
                    {tag}
                    <button onClick={() => removeTag(rule.org_id, tag)} className="text-teal-400 hover:text-teal-600"><X size={9} /></button>
                  </span>
                ))}
                <div className="inline-flex items-center gap-1">
                  <input
                    value={newTag[rule.org_id] || ''}
                    onChange={e => setNewTag(prev => ({ ...prev, [rule.org_id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(rule.org_id) } }}
                    placeholder="Add tag..."
                    className="px-2 py-1 text-[10px] border border-gray-200 rounded-lg w-36 focus:outline-none focus:ring-1 focus:ring-teal-200"
                  />
                  <button onClick={() => addTag(rule.org_id)} className="text-teal-400 hover:text-teal-600"><Plus size={12} /></button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg">
              <ArrowRight size={10} className="text-gray-400" />
              <span className="text-[10px] text-gray-500">
                When a <strong>{rule.org_name}</strong> contact is tagged
                {rule.tags.length > 0 ? ` "${rule.tags.join('" or "')}"` : ' (none configured)'},
                it will appear in <strong>{currentOrg?.name}</strong>&apos;s CRM with a <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-[8px] font-bold">{rule.org_name.split(' ')[0]}</span> badge.
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* Add new org */}
      {unlinkedOrgs.length > 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-4">
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Add Cross-Org Source</span>
          <div className="flex flex-wrap gap-2">
            {unlinkedOrgs.map(org => (
              <button key={org.id} onClick={() => addRule(org.id, org.name)}
                className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-[11px] font-medium text-np-dark hover:border-np-blue hover:bg-np-blue/5 transition-colors">
                <Plus size={10} className="text-np-blue" /> {org.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={saveConfig} disabled={saving}
          className="flex items-center gap-1.5 px-5 py-2.5 bg-teal text-white text-xs font-semibold rounded-xl hover:bg-teal-700 disabled:opacity-50 shadow-sm transition-colors">
          {saving ? <Loader2 size={12} className="animate-spin" /> : saved ? <Check size={12} /> : <Save size={12} />}
          {saving ? 'Saving...' : saved ? 'Saved!' : 'Save Sharing Rules'}
        </button>
      </div>
    </div>
  )
}
