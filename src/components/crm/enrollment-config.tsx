'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Plus, Trash2, FileText, ClipboardCheck, Check, Loader2, X, Shield, ArrowRight, Sparkles, ExternalLink, GripVertical } from 'lucide-react'

interface EnrollmentService {
  id: string; name: string
  consent_form_library_id: string | null
  intake_form_id: string | null
  active: boolean
}

interface LibraryDoc { id: string; title: string; category: string; file_url: string | null }

const DEFAULT_SENSORIUM_SERVICES: EnrollmentService[] = [
  { id: 'redlight', name: 'Redlight Therapy', consent_form_library_id: null, intake_form_id: null, active: true },
  { id: 'hyperbaric', name: 'Hyperbaric', consent_form_library_id: null, intake_form_id: null, active: true },
  { id: 'contrast', name: 'Contrast Therapy', consent_form_library_id: null, intake_form_id: null, active: true },
  { id: 'neuro_program', name: 'Neuro Program', consent_form_library_id: null, intake_form_id: null, active: true },
  { id: 'bio_program', name: 'Bio Program', consent_form_library_id: null, intake_form_id: null, active: true },
]

const DEFAULT_NP_SERVICES: EnrollmentService[] = [
  { id: 'immersive_mastermind', name: 'Immersive Mastermind', consent_form_library_id: null, intake_form_id: null, active: true },
  { id: 'vr_biofeedback', name: 'VR Biofeedback', consent_form_library_id: null, intake_form_id: null, active: true },
]

export default function EnrollmentConfig({ orgId, orgName }: { orgId: string; orgName?: string }) {
  const supabase = createClient()
  const [services, setServices] = useState<EnrollmentService[]>([])
  const [libraryDocs, setLibraryDocs] = useState<LibraryDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [showWizard, setShowWizard] = useState(false)

  useEffect(() => {
    if (!orgId) return
    setLoading(true)
    Promise.all([
      supabase.from('org_settings').select('setting_value').eq('org_id', orgId).eq('setting_key', 'crm_enrollment_config').maybeSingle(),
      supabase.from('company_library').select('id, title, category, file_url').eq('org_id', orgId).order('title'),
    ]).then(([configRes, libRes]) => {
      const config = configRes.data?.setting_value
      if (config?.services) setServices(config.services)
      if (libRes.data) setLibraryDocs(libRes.data)
      setLoading(false)
    })
  }, [orgId])

  const save = async (svcs?: EnrollmentService[]) => {
    const toSave = svcs || services
    setSaving(true)
    await supabase.from('org_settings').upsert({
      org_id: orgId, setting_key: 'crm_enrollment_config',
      setting_value: { services: toSave, default_services_by_pipeline: {} },
    }, { onConflict: 'org_id,setting_key' })
    setSaving(false); setSaved(true); setTimeout(() => setSaved(false), 2000)
  }

  const addService = () => {
    if (!newName.trim()) return
    const id = newName.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')
    const svc: EnrollmentService = { id, name: newName.trim(), consent_form_library_id: null, intake_form_id: null, active: true }
    setServices(prev => [...prev, svc])
    setNewName(''); setShowAdd(false)
  }

  const removeService = (id: string) => setServices(prev => prev.filter(s => s.id !== id))
  const toggleActive = (id: string) => setServices(prev => prev.map(s => s.id === id ? { ...s, active: !s.active } : s))
  const updateService = (id: string, updates: Partial<EnrollmentService>) => setServices(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s))

  const loadPreset = (preset: 'sensorium' | 'np') => {
    const defaults = preset === 'sensorium' ? DEFAULT_SENSORIUM_SERVICES : DEFAULT_NP_SERVICES
    // Merge, don't overwrite existing
    const existing = new Set(services.map(s => s.id))
    const merged = [...services, ...defaults.filter(d => !existing.has(d.id))]
    setServices(merged); setShowWizard(false)
  }

  const consentDocs = libraryDocs.filter(d => d.category?.toLowerCase().includes('consent') || d.title?.toLowerCase().includes('consent'))
  const allDocs = libraryDocs

  if (loading) return <div className="flex items-center gap-2 text-xs text-gray-400 py-8"><Loader2 size={12} className="animate-spin" /> Loading...</div>

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold text-np-dark flex items-center gap-2"><Shield size={14} className="text-teal" /> Enrollment Configuration</h3>
        <p className="text-xs text-gray-400 mt-0.5">Define services, link consent forms from Company Library, and intake forms from NeuroReport.</p>
      </div>

      {/* Quick setup wizard */}
      {services.length === 0 && (
        <div className="bg-teal/5 border border-teal/20 rounded-xl p-5 text-center">
          <Shield size={24} className="mx-auto text-teal mb-2" />
          <h4 className="text-xs font-bold text-np-dark">Quick Setup</h4>
          <p className="text-[10px] text-gray-400 mt-1 mb-4 max-w-sm mx-auto">Choose a preset to get started, or add services manually.</p>
          <div className="flex justify-center gap-3">
            <button onClick={() => loadPreset('sensorium')}
              className="px-4 py-2.5 bg-white border border-teal/30 text-xs font-semibold text-teal rounded-xl hover:bg-teal/5 transition-colors">
              🧠 Sensorium Services
            </button>
            <button onClick={() => loadPreset('np')}
              className="px-4 py-2.5 bg-white border border-violet-200 text-xs font-semibold text-violet-600 rounded-xl hover:bg-violet-50 transition-colors">
              ⚡ Neuro Progeny Programs
            </button>
            <button onClick={() => setShowAdd(true)}
              className="px-4 py-2.5 bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-500 rounded-xl hover:bg-gray-100 transition-colors">
              <Plus size={11} className="inline mr-1" /> Custom
            </button>
          </div>
        </div>
      )}

      {/* Service list */}
      {services.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">{services.length} Services</span>
            <div className="flex gap-2">
              <button onClick={() => setShowWizard(!showWizard)}
                className="text-[10px] font-semibold text-teal hover:text-teal/80 flex items-center gap-1">
                <Sparkles size={10} /> Load Preset
              </button>
              <button onClick={() => setShowAdd(true)}
                className="text-[10px] font-semibold text-np-blue hover:text-np-dark flex items-center gap-1">
                <Plus size={10} /> Add Service
              </button>
            </div>
          </div>

          {showWizard && (
            <div className="flex gap-2 p-3 bg-gray-50 rounded-lg">
              <button onClick={() => loadPreset('sensorium')} className="px-3 py-1.5 text-[10px] font-semibold bg-teal/10 text-teal rounded-lg">+ Sensorium</button>
              <button onClick={() => loadPreset('np')} className="px-3 py-1.5 text-[10px] font-semibold bg-violet-50 text-violet-600 rounded-lg">+ Neuro Progeny</button>
              <button onClick={() => setShowWizard(false)} className="ml-auto text-gray-300 hover:text-gray-500"><X size={12} /></button>
            </div>
          )}

          {services.map(svc => (
            <div key={svc.id} className={`rounded-xl border p-4 space-y-3 ${svc.active ? 'border-gray-100 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => toggleActive(svc.id)}
                  className={`w-5 h-5 rounded-md flex items-center justify-center border-2 shrink-0 ${
                    svc.active ? 'bg-teal border-teal' : 'border-gray-300'
                  }`}>{svc.active && <Check size={11} className="text-white" strokeWidth={3} />}</button>
                <input value={svc.name} onChange={e => updateService(svc.id, { name: e.target.value })}
                  className="flex-1 text-xs font-semibold text-np-dark bg-transparent focus:outline-none focus:bg-gray-50 focus:px-2 rounded-lg" />
                <button onClick={() => removeService(svc.id)} className="text-gray-300 hover:text-red-400 p-1">
                  <Trash2 size={12} />
                </button>
              </div>

              {svc.active && (
                <div className="grid grid-cols-2 gap-3 pl-8">
                  {/* Consent form link */}
                  <div>
                    <label className="text-[8px] font-bold text-gray-400 uppercase flex items-center gap-1">
                      <FileText size={9} /> Consent Form <span className="text-gray-300 normal-case">(from Library)</span>
                    </label>
                    <select value={svc.consent_form_library_id || ''} onChange={e => updateService(svc.id, { consent_form_library_id: e.target.value || null })}
                      className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30">
                      <option value="">None linked</option>
                      {consentDocs.length > 0 && <optgroup label="📋 Consent Forms">
                        {consentDocs.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
                      </optgroup>}
                      <optgroup label="📁 All Library Documents">
                        {allDocs.filter(d => !consentDocs.some(c => c.id === d.id)).map(d => (
                          <option key={d.id} value={d.id}>{d.title} ({d.category})</option>
                        ))}
                      </optgroup>
                    </select>
                    {svc.consent_form_library_id && (
                      <a href={libraryDocs.find(d => d.id === svc.consent_form_library_id)?.file_url || '#'} target="_blank"
                        className="text-[9px] text-np-blue flex items-center gap-0.5 mt-1 hover:underline">
                        <ExternalLink size={8} /> Preview
                      </a>
                    )}
                  </div>

                  {/* Intake form link */}
                  <div>
                    <label className="text-[8px] font-bold text-gray-400 uppercase flex items-center gap-1">
                      <ClipboardCheck size={9} /> Intake Form <span className="text-gray-300 normal-case">(from NeuroReport)</span>
                    </label>
                    <input value={svc.intake_form_id || ''} onChange={e => updateService(svc.id, { intake_form_id: e.target.value || null })}
                      placeholder="NeuroReport form ID or URL"
                      className="w-full mt-0.5 px-2 py-1.5 text-[10px] border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30" />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add service inline */}
      {showAdd && (
        <div className="flex gap-2 items-center bg-gray-50 p-3 rounded-lg border border-gray-200">
          <input value={newName} onChange={e => setNewName(e.target.value)} autoFocus
            onKeyDown={e => { if (e.key === 'Enter') addService() }}
            placeholder="Service name (e.g. Neurofeedback)..."
            className="flex-1 px-3 py-2 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none" />
          <button onClick={addService} disabled={!newName.trim()} className="px-3 py-2 bg-teal text-white text-[10px] font-semibold rounded-lg disabled:opacity-40">Add</button>
          <button onClick={() => { setShowAdd(false); setNewName('') }} className="text-gray-300 hover:text-gray-500"><X size={14} /></button>
        </div>
      )}

      {/* Save */}
      {services.length > 0 && (
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <span className="text-[10px] text-gray-400">{services.filter(s => s.active).length} active · {services.filter(s => s.consent_form_library_id).length} with consent forms</span>
          <button onClick={() => save()} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-semibold rounded-xl disabled:opacity-50 hover:bg-np-dark transition-colors">
            {saving ? <Loader2 size={11} className="animate-spin" /> : saved ? <Check size={11} /> : null}
            {saved ? 'Saved!' : 'Save Configuration'}
          </button>
        </div>
      )}
    </div>
  )
}
