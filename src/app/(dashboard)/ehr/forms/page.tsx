'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import ContactDetail from '@/components/crm/contact-detail'
import {
  FileCheck, Plus, Search, Wand2, Send, X, Save, Loader2, Eye, FileText,
  ClipboardList, Download, Trash2, Copy, Users, ChevronDown, Check,
  Mic, MicOff, Square, ExternalLink, RotateCcw, Sparkles, Settings,
  PenLine, FilePlus, BookOpen, User
} from 'lucide-react'

/* ═══ TYPES ═══ */
interface FormTemplate {
  id: string; org_id: string; name: string; form_type: 'consent' | 'intake' | 'assessment' | 'custom'
  description?: string; html_content: string; fields_schema?: any[]; is_active: boolean
  version: number; created_at: string; updated_at: string
}

interface FormSubmission {
  id: string; template_id: string; org_id: string; contact_id?: string
  contact_name?: string; submission_data: Record<string, any>
  signature_data?: string; signed_at?: string; status: 'draft' | 'completed' | 'reviewed'
  created_at: string
}

const FORM_TYPES = [
  { value: 'consent', label: 'Consent Form', icon: FileCheck, color: 'text-green-500', bg: 'bg-green-50' },
  { value: 'intake', label: 'Intake Form', icon: ClipboardList, color: 'text-blue-500', bg: 'bg-blue-50' },
  { value: 'assessment', label: 'Assessment', icon: FileText, color: 'text-purple-500', bg: 'bg-purple-50' },
  { value: 'custom', label: 'Custom Form', icon: PenLine, color: 'text-amber-500', bg: 'bg-amber-50' },
] as const

export default function FormsPage() {
  const { currentOrg, user } = useWorkspace()
  const supabase = createClient()

  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [submissions, setSubmissions] = useState<FormSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedTemplate, setSelectedTemplate] = useState<FormTemplate | null>(null)
  const [view, setView] = useState<'preview' | 'edit' | 'submissions' | 'fill'>('preview')
  const [search, setSearch] = useState('')

  // AI Creator
  const [showCreator, setShowCreator] = useState(false)
  const [aiType, setAiType] = useState<'consent' | 'intake' | 'assessment' | 'custom'>('consent')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiProcessing, setAiProcessing] = useState(false)
  const [aiName, setAiName] = useState('')

  // Edit mode
  const [editHtml, setEditHtml] = useState('')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [saving, setSaving] = useState(false)

  // Fill mode
  const [fillData, setFillData] = useState<Record<string, any>>({})
  const [fillContact, setFillContact] = useState('')
  const [fillContactId, setFillContactId] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])

  // Contact detail
  const [showContactDetail, setShowContactDetail] = useState<string | null>(null)

  // Voice
  const [isRecording, setIsRecording] = useState(false)
  const [voiceTranscript, setVoiceTranscript] = useState('')
  const recognitionRef = useRef<any>(null)

  /* ─── Load ─── */
  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    const [tRes, sRes] = await Promise.all([
      supabase.from('ehr_form_templates').select('*').eq('org_id', currentOrg.id).order('updated_at', { ascending: false }),
      supabase.from('ehr_form_submissions').select('*').eq('org_id', currentOrg.id).order('created_at', { ascending: false }).limit(100),
    ])
    setTemplates(tRes.data || [])
    setSubmissions(sRes.data || [])
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { load() }, [load])

  /* ─── Filter templates ─── */
  const filteredTemplates = templates.filter(t => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return t.name.toLowerCase().includes(q) || t.form_type.includes(q)
  })

  /* ─── AI Form Generation ─── */
  const generateForm = async () => {
    if (!currentOrg) return
    setAiProcessing(true)

    const typeDescriptions: Record<string, string> = {
      consent: `Create a professional clinical consent form for a neuroscience wellness practice. Include:
- Practice name header (use "{PRACTICE_NAME}" as placeholder)
- Clear explanation of services/treatments being consented to
- Risks, benefits, and alternatives section
- Confidentiality/HIPAA notice
- Right to withdraw consent
- Signature line with date
- Witness signature line
- Parent/guardian signature if applicable`,
      intake: `Create a comprehensive clinical intake form for a neuroscience wellness practice. Include:
- Personal information (name, DOB, address, phone, email, emergency contact)
- Insurance information section
- Medical history (current conditions, medications, surgeries, allergies)
- Mental health history (diagnoses, current symptoms, previous treatment)
- Neurological history (head injuries, seizures, migraines, concussions)
- Family medical history
- Current concerns and goals for treatment
- Sleep patterns, exercise, substance use
- Previous brain mapping or neurofeedback experience
- Signature and date`,
      assessment: `Create a clinical assessment form for neuroscience evaluation. Include:
- Client information header
- Presenting concerns
- Symptom severity scales (1-10)
- Cognitive function assessment
- Emotional regulation assessment
- Sleep quality assessment
- Stress/anxiety indicators
- Focus and attention measures
- Physical symptoms checklist
- Clinician notes section
- Recommendations section`,
      custom: 'Create a professional clinical form based on the specific instructions provided.',
    }

    const systemPrompt = `You are a clinical form designer for Sensorium Neuro Wellness / Neuro Progeny, a neuroscience wellness practice specializing in qEEG brain mapping, neurofeedback, VR biofeedback, and multimodal neurotherapy.

${typeDescriptions[aiType]}

${aiPrompt ? `ADDITIONAL INSTRUCTIONS: ${aiPrompt}` : ''}

Generate a complete, professional HTML form. Requirements:
1. Use clean, modern styling with inline CSS
2. Use a professional color scheme (navy #1a365d headers, clean white body, subtle borders)
3. Include proper form input fields (text, checkbox, textarea, date, select as needed)
4. Each input must have a unique name attribute for data capture
5. Make it print-friendly (no dark backgrounds on large areas)
6. Use professional medical/clinical language at 9th grade reading level
7. Include the practice name "{PRACTICE_NAME}" as a placeholder
8. Add proper spacing and section dividers
9. Include a footer with form version and date
10. All inputs should have clear labels

Respond with ONLY the HTML content (no markdown code blocks, no explanation). Start with <div class="form-container"> and end with </div>.`

    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content: `Generate a ${aiType} form.${aiPrompt ? ' ' + aiPrompt : ''}` }],
          campaignContext: { systemOverride: systemPrompt },
        }),
      })
      const data = await res.json()
      let html = data.content || data.message || data.text || ''
      // Clean up markdown code blocks if present
      html = html.replace(/```html?\n?/g, '').replace(/```\n?/g, '').trim()
      // Replace practice name placeholder
      html = html.replace(/\{PRACTICE_NAME\}/g, currentOrg.name || 'Sensorium Neuro Wellness')

      if (html) {
        const name = aiName.trim() || `${FORM_TYPES.find(t => t.value === aiType)?.label || 'Form'} - ${new Date().toLocaleDateString()}`
        const { data: newTemplate, error } = await supabase.from('ehr_form_templates').insert({
          org_id: currentOrg.id,
          name,
          form_type: aiType,
          description: aiPrompt || `AI-generated ${aiType} form`,
          html_content: html,
          is_active: true,
          version: 1,
        }).select().single()

        if (error) { console.error(error); alert('Failed to save form: ' + error.message) }
        else {
          await load()
          setSelectedTemplate(newTemplate)
          setView('preview')
          setShowCreator(false)
          setAiPrompt('')
          setAiName('')
        }
      }
    } catch (e) { console.error(e); alert('AI generation failed. Please try again.') }
    setAiProcessing(false)
  }

  /* ─── Save template edits ─── */
  const saveTemplate = async () => {
    if (!selectedTemplate || !currentOrg) return
    setSaving(true)
    await supabase.from('ehr_form_templates').update({
      name: editName, description: editDesc, html_content: editHtml,
      version: selectedTemplate.version + 1, updated_at: new Date().toISOString(),
    }).eq('id', selectedTemplate.id)
    await load()
    setSaving(false)
    setView('preview')
  }

  /* ─── Delete template ─── */
  const deleteTemplate = async (id: string) => {
    if (!confirm('Delete this form template? This cannot be undone.')) return
    await supabase.from('ehr_form_templates').delete().eq('id', id)
    if (selectedTemplate?.id === id) setSelectedTemplate(null)
    await load()
  }

  /* ─── Search contacts for fill ─── */
  const searchContacts = async (q: string) => {
    setContactSearch(q)
    if (!q.trim() || !currentOrg) { setContactResults([]); return }
    const { data } = await supabase.from('contacts').select('id, first_name, last_name, email')
      .eq('org_id', currentOrg.id).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`).limit(8)
    setContactResults(data || [])
  }

  /* ─── Submit form ─── */
  const submitForm = async () => {
    if (!selectedTemplate || !currentOrg) return
    setSaving(true)
    const { error } = await supabase.from('ehr_form_submissions').insert({
      template_id: selectedTemplate.id,
      org_id: currentOrg.id,
      contact_id: fillContactId || null,
      contact_name: fillContact || 'Anonymous',
      submission_data: fillData,
      status: 'completed',
      signed_at: new Date().toISOString(),
    })
    if (error) { alert('Failed to submit: ' + error.message) }
    else {
      alert('Form submitted successfully!')
      setView('preview')
      setFillData({})
      setFillContact('')
      setFillContactId('')
      await load()
    }
    setSaving(false)
  }

  /* ─── Generate PDF and save to library ─── */
  const savePdfToLibrary = async () => {
    if (!selectedTemplate || !currentOrg) return
    setSaving(true)
    try {
      // Save as library document (HTML content that can be printed)
      await supabase.from('company_library').insert({
        org_id: currentOrg.id,
        title: selectedTemplate.name + ' (Form Template)',
        description: `AI-generated ${selectedTemplate.form_type} form. Print-ready version.`,
        category: 'forms',
        content_type: 'form_template',
        content: selectedTemplate.html_content,
        created_by: user?.id,
        tags: [selectedTemplate.form_type, 'form', 'template'],
      })
      alert('Form saved to Company Library under "Forms" category!')
    } catch (e) { console.error(e); alert('Failed to save to library.') }
    setSaving(false)
  }

  /* ─── Voice ─── */
  const startVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Use Chrome.'); return }
    const rec = new SR()
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'
    let final = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '
        else interim += e.results[i][0].transcript
      }
      setVoiceTranscript(final.trim() + (interim ? ' ' + interim : ''))
    }
    rec.onerror = () => setIsRecording(false)
    recognitionRef.current = rec
    setVoiceTranscript(''); setIsRecording(true); rec.start()
  }
  const stopVoice = () => {
    if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }
    setIsRecording(false)
    if (voiceTranscript.trim()) { setAiPrompt(prev => prev + (prev ? ' ' : '') + voiceTranscript.trim()) }
    setVoiceTranscript('')
  }

  /* ─── Parse form HTML for input fields ─── */
  const extractFields = (html: string): { name: string; type: string; label: string }[] => {
    const fields: { name: string; type: string; label: string }[] = []
    const div = typeof document !== 'undefined' ? document.createElement('div') : null
    if (!div) return fields
    div.innerHTML = html
    div.querySelectorAll('input, textarea, select').forEach((el) => {
      const name = el.getAttribute('name')
      if (!name) return
      const type = el.getAttribute('type') || el.tagName.toLowerCase()
      // Find label
      const id = el.getAttribute('id')
      const labelEl = id ? div.querySelector(`label[for="${id}"]`) : null
      const label = labelEl?.textContent?.trim() || name.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      fields.push({ name, type, label })
    })
    return fields
  }

  /* ─── Select template and enter edit mode ─── */
  const selectForEdit = (t: FormTemplate) => {
    setSelectedTemplate(t)
    setEditHtml(t.html_content)
    setEditName(t.name)
    setEditDesc(t.description || '')
    setView('edit')
  }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  return (
    <div className="flex gap-4 h-[calc(100vh-6rem)]">
      {/* ═══ LEFT: Template List ═══ */}
      <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-np-dark flex items-center gap-1.5">
              <FileCheck className="w-3.5 h-3.5 text-np-blue" /> Forms
            </h2>
            <button onClick={() => setShowCreator(true)}
              className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark transition-colors">
              <Plus className="w-3 h-3" /> New
            </button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search forms..."
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filteredTemplates.length === 0 ? (
            <div className="p-6 text-center">
              <FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" />
              <p className="text-xs text-gray-400">No forms yet</p>
              <button onClick={() => setShowCreator(true)} className="text-[10px] text-np-blue hover:underline mt-1">Create your first form</button>
            </div>
          ) : (
            filteredTemplates.map(t => {
              const typeInfo = FORM_TYPES.find(ft => ft.value === t.form_type) || FORM_TYPES[3]
              const Icon = typeInfo.icon
              const subCount = submissions.filter(s => s.template_id === t.id).length
              return (
                <button key={t.id} onClick={() => { setSelectedTemplate(t); setView('preview') }}
                  className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors
                    ${selectedTemplate?.id === t.id ? 'bg-np-blue/5 border-l-2 border-l-np-blue' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className={`w-6 h-6 rounded-md ${typeInfo.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                      <Icon className={`w-3 h-3 ${typeInfo.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-np-dark truncate">{t.name}</p>
                      <p className="text-[9px] text-gray-400 mt-0.5">{typeInfo.label} · v{t.version}</p>
                      {subCount > 0 && <p className="text-[9px] text-np-blue mt-0.5">{subCount} submission{subCount !== 1 ? 's' : ''}</p>}
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="p-2 border-t border-gray-50 text-center">
          <p className="text-[9px] text-gray-300">{templates.length} form{templates.length !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* ═══ MAIN AREA ═══ */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedTemplate && !showCreator ? (
          <div className="flex-1 flex items-center justify-center bg-white border border-gray-100 rounded-2xl">
            <div className="text-center max-w-md">
              <FileCheck className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Consent & Intake Forms</h2>
              <p className="text-sm text-gray-400 mb-6">Create AI-powered consent forms, intake questionnaires, and assessments. Generated forms can be saved to your library as printable templates.</p>
              <button onClick={() => setShowCreator(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-lg text-sm font-medium hover:bg-np-dark transition-colors">
                <Wand2 className="w-4 h-4" /> Create Form with AI
              </button>
            </div>
          </div>
        ) : showCreator ? (
          /* ═══ AI FORM CREATOR ═══ */
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-base font-bold text-np-dark flex items-center gap-2">
                  <Wand2 className="w-5 h-5 text-purple-500" /> AI Form Creator
                </h2>
                <button onClick={() => setShowCreator(false)} className="p-1.5 rounded hover:bg-gray-50"><X className="w-4 h-4 text-gray-400" /></button>
              </div>

              <div className="space-y-5">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">Form Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {FORM_TYPES.map(ft => (
                      <button key={ft.value} onClick={() => setAiType(ft.value as any)}
                        className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all
                          ${aiType === ft.value ? 'border-np-blue bg-np-blue/5 ring-1 ring-np-blue/20' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className={`w-8 h-8 rounded-lg ${ft.bg} flex items-center justify-center`}>
                          <ft.icon className={`w-4 h-4 ${ft.color}`} />
                        </div>
                        <div className="text-left">
                          <p className="text-xs font-semibold text-np-dark">{ft.label}</p>
                          <p className="text-[9px] text-gray-400">
                            {ft.value === 'consent' ? 'Treatment consent & HIPAA' : ft.value === 'intake' ? 'Patient intake questionnaire' : ft.value === 'assessment' ? 'Clinical evaluation' : 'Custom form'}
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Form Name</label>
                  <input value={aiName} onChange={e => setAiName(e.target.value)}
                    placeholder={`e.g. ${aiType === 'consent' ? 'General Treatment Consent' : aiType === 'intake' ? 'New Patient Intake' : 'Initial Assessment'}`}
                    className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">Custom Instructions (optional)</label>
                  <div className="relative">
                    <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                      placeholder="Add any specific requirements, sections, or language you want included..."
                      rows={4}
                      className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none" />
                    {isRecording && (
                      <div className="absolute inset-0 bg-red-50/90 rounded-lg flex items-center justify-center">
                        <div className="text-center">
                          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse inline-block mb-1" />
                          <p className="text-[10px] text-red-600 font-medium">Recording... {voiceTranscript.slice(-60)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <button onClick={() => isRecording ? stopVoice() : startVoice()}
                      className={`flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-colors ${isRecording ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-purple-100 hover:text-purple-600'}`}>
                      {isRecording ? <><MicOff className="w-3 h-3" /> Stop</> : <><Mic className="w-3 h-3" /> Voice</>}
                    </button>
                    <p className="text-[9px] text-gray-300">Describe what you want in the form</p>
                  </div>
                </div>

                <div className="bg-gray-50 rounded-xl p-4">
                  <p className="text-[10px] font-semibold text-gray-500 mb-2">What AI will generate:</p>
                  <ul className="space-y-1">
                    {aiType === 'consent' && ['Practice header with branding', 'Services description', 'Risks & benefits', 'HIPAA notice', 'Signature lines'].map(i =>
                      <li key={i} className="text-[10px] text-gray-400 flex items-center gap-1.5"><Check className="w-3 h-3 text-green-400" />{i}</li>)}
                    {aiType === 'intake' && ['Personal & contact info', 'Medical history', 'Mental health history', 'Neurological history', 'Goals & concerns', 'Signature'].map(i =>
                      <li key={i} className="text-[10px] text-gray-400 flex items-center gap-1.5"><Check className="w-3 h-3 text-green-400" />{i}</li>)}
                    {aiType === 'assessment' && ['Client info', 'Symptom scales', 'Cognitive assessment', 'Emotional regulation', 'Clinician notes'].map(i =>
                      <li key={i} className="text-[10px] text-gray-400 flex items-center gap-1.5"><Check className="w-3 h-3 text-green-400" />{i}</li>)}
                    {aiType === 'custom' && <li className="text-[10px] text-gray-400">Provide instructions above for the AI to follow</li>}
                  </ul>
                </div>

                <button onClick={generateForm} disabled={aiProcessing}
                  className="w-full py-3 bg-purple-500 text-white text-sm font-medium rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {aiProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> Generating Form...</> : <><Sparkles className="w-4 h-4" /> Generate Form</>}
                </button>
              </div>
            </div>
          </div>
        ) : selectedTemplate && (
          <>
            {/* Template header + tabs */}
            <div className="bg-white border border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-np-dark">{selectedTemplate.name}</h2>
                <p className="text-[10px] text-gray-400">
                  {FORM_TYPES.find(t => t.value === selectedTemplate.form_type)?.label} · v{selectedTemplate.version}
                  {selectedTemplate.description && ` · ${selectedTemplate.description}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5">
                {(['preview', 'edit', 'fill', 'submissions'] as const).map(v => (
                  <button key={v} onClick={() => {
                    if (v === 'edit') selectForEdit(selectedTemplate)
                    else setView(v)
                  }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                      ${view === v ? 'bg-np-blue text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                    {v === 'preview' ? 'Preview' : v === 'edit' ? 'Edit' : v === 'fill' ? 'Fill Out' : 'Submissions'}
                  </button>
                ))}
                <div className="w-px h-6 bg-gray-200 mx-1" />
                <button onClick={savePdfToLibrary} disabled={saving} title="Save to Library"
                  className="p-1.5 text-gray-400 hover:text-np-blue rounded-lg hover:bg-gray-50 transition-colors">
                  <BookOpen className="w-4 h-4" />
                </button>
                <button onClick={() => deleteTemplate(selectedTemplate.id)} title="Delete"
                  className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden border border-t-0 border-gray-100 rounded-b-2xl bg-white">
              {/* ─── PREVIEW ─── */}
              {view === 'preview' && (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-xl shadow-sm p-8">
                    <div dangerouslySetInnerHTML={{ __html: selectedTemplate.html_content }} />
                  </div>
                  <div className="max-w-3xl mx-auto mt-4 flex items-center justify-center gap-3">
                    <button onClick={() => {
                      const w = window.open('', '_blank')
                      if (w) { w.document.write(`<html><head><title>${selectedTemplate.name}</title></head><body>${selectedTemplate.html_content}</body></html>`); w.document.close(); w.print() }
                    }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors">
                      <Download className="w-3.5 h-3.5" /> Print / Save PDF
                    </button>
                    <button onClick={savePdfToLibrary} disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-np-blue bg-np-blue/5 hover:bg-np-blue/10 rounded-lg transition-colors">
                      <BookOpen className="w-3.5 h-3.5" /> Save to Library
                    </button>
                    <button onClick={() => setView('fill')}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors">
                      <PenLine className="w-3.5 h-3.5" /> Fill Out Form
                    </button>
                  </div>
                </div>
              )}

              {/* ─── EDIT HTML ─── */}
              {view === 'edit' && (
                <div className="h-full flex flex-col p-5">
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Name</label>
                      <input value={editName} onChange={e => setEditName(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Description</label>
                      <input value={editDesc} onChange={e => setEditDesc(e.target.value)}
                        className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                    </div>
                  </div>
                  <textarea value={editHtml} onChange={e => setEditHtml(e.target.value)}
                    className="flex-1 px-4 py-3 text-[11px] font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-none"
                    spellCheck={false} />
                  <div className="flex justify-end gap-2 mt-3">
                    <button onClick={() => setView('preview')} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
                    <button onClick={saveTemplate} disabled={saving}
                      className="px-4 py-2 text-xs font-medium text-white bg-np-blue hover:bg-np-dark rounded-lg transition-colors disabled:opacity-50">
                      {saving ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : <Save className="w-3 h-3 inline mr-1" />} Save Changes
                    </button>
                  </div>
                </div>
              )}

              {/* ─── FILL OUT FORM ─── */}
              {view === 'fill' && (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-2xl mx-auto">
                    <div className="bg-np-blue/5 border border-np-blue/20 rounded-xl p-4 mb-5">
                      <p className="text-xs font-medium text-np-dark mb-2">Link to Contact (optional)</p>
                      <div className="relative">
                        <input value={contactSearch} onChange={e => { searchContacts(e.target.value); setFillContact(e.target.value) }}
                          placeholder="Search for a contact..."
                          className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                        {contactResults.length > 0 && (
                          <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                            {contactResults.map(c => (
                              <button key={c.id} onClick={() => {
                                setFillContact(`${c.first_name} ${c.last_name}`)
                                setFillContactId(c.id)
                                setContactResults([])
                                setContactSearch(`${c.first_name} ${c.last_name}`)
                                // Pre-fill form data from contact
                                setFillData(prev => ({
                                  ...prev,
                                  first_name: c.first_name, last_name: c.last_name, email: c.email,
                                  patient_name: `${c.first_name} ${c.last_name}`, full_name: `${c.first_name} ${c.last_name}`,
                                }))
                              }}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-50">
                                <span className="font-medium">{c.first_name} {c.last_name}</span>
                                {c.email && <span className="text-gray-400 ml-2">{c.email}</span>}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {fillContactId && (
                        <button onClick={() => setShowContactDetail(fillContactId)}
                          className="text-[10px] text-np-blue hover:underline mt-1.5 flex items-center gap-1">
                          <ExternalLink className="w-3 h-3" /> View contact details
                        </button>
                      )}
                    </div>

                    {/* Render form with editable fields */}
                    <div className="bg-white border border-gray-200 rounded-xl p-8">
                      <div dangerouslySetInnerHTML={{ __html: selectedTemplate.html_content }} />
                    </div>

                    <div className="mt-4 p-4 bg-gray-50 rounded-xl">
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Manual Data Entry</p>
                      <p className="text-[10px] text-gray-400 mb-3">Fill in the key fields below. This data will be stored and available when creating reports.</p>
                      <div className="grid grid-cols-2 gap-3">
                        {(() => {
                          const fields = extractFields(selectedTemplate.html_content)
                          return fields.length > 0 ? fields.slice(0, 30).map(f => (
                            <div key={f.name} className={f.type === 'textarea' ? 'col-span-2' : ''}>
                              <label className="text-[9px] font-medium text-gray-500 uppercase tracking-wider mb-0.5 block">{f.label}</label>
                              {f.type === 'checkbox' ? (
                                <label className="flex items-center gap-1.5 cursor-pointer">
                                  <input type="checkbox" checked={!!fillData[f.name]}
                                    onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.checked }))}
                                    className="accent-np-blue w-3.5 h-3.5" />
                                  <span className="text-xs text-gray-600">Yes</span>
                                </label>
                              ) : f.type === 'textarea' ? (
                                <textarea value={fillData[f.name] || ''} onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.value }))}
                                  rows={2} className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                              ) : (
                                <input type={f.type === 'date' ? 'date' : 'text'} value={fillData[f.name] || ''}
                                  onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.value }))}
                                  className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                              )}
                            </div>
                          )) : (
                            <p className="col-span-2 text-[10px] text-gray-400 italic">No input fields detected in form HTML. You can still submit with manual notes.</p>
                          )
                        })()}
                        <div className="col-span-2">
                          <label className="text-[9px] font-medium text-gray-500 uppercase tracking-wider mb-0.5 block">Additional Notes</label>
                          <textarea value={fillData._notes || ''} onChange={e => setFillData(d => ({ ...d, _notes: e.target.value }))}
                            rows={3} placeholder="Any additional notes..."
                            className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 mt-4">
                      <button onClick={() => setView('preview')} className="px-3 py-2 text-xs text-gray-400">Cancel</button>
                      <button onClick={submitForm} disabled={saving}
                        className="px-4 py-2 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-1.5">
                        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Submit Form
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ─── SUBMISSIONS ─── */}
              {view === 'submissions' && (
                <div className="h-full overflow-y-auto p-5">
                  <h3 className="text-sm font-bold text-np-dark mb-4">
                    Submissions ({submissions.filter(s => s.template_id === selectedTemplate.id).length})
                  </h3>
                  {submissions.filter(s => s.template_id === selectedTemplate.id).length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                      <p className="text-sm text-gray-400">No submissions yet</p>
                      <button onClick={() => setView('fill')} className="text-xs text-np-blue hover:underline mt-2">Fill out this form</button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {submissions.filter(s => s.template_id === selectedTemplate.id).map(s => (
                        <div key={s.id} className="border border-gray-100 rounded-xl p-4 hover:border-np-blue/20 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <User className="w-4 h-4 text-gray-400" />
                              <span className="text-xs font-semibold text-np-dark">{s.contact_name || 'Anonymous'}</span>
                              {s.contact_id && (
                                <button onClick={() => setShowContactDetail(s.contact_id!)}
                                  className="text-[9px] text-np-blue hover:underline">View contact</button>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium
                                ${s.status === 'completed' ? 'bg-green-100 text-green-700' : s.status === 'reviewed' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                                {s.status}
                              </span>
                              <span className="text-[9px] text-gray-400">{new Date(s.created_at).toLocaleDateString()}</span>
                            </div>
                          </div>
                          {/* Show key submission data */}
                          <div className="grid grid-cols-3 gap-2 mt-2">
                            {Object.entries(s.submission_data || {}).filter(([k]) => !k.startsWith('_')).slice(0, 6).map(([k, v]) => (
                              <div key={k}>
                                <p className="text-[8px] text-gray-400 uppercase">{k.replace(/[_-]/g, ' ')}</p>
                                <p className="text-[10px] text-np-dark truncate">{String(v) || '--'}</p>
                              </div>
                            ))}
                          </div>
                          {Object.keys(s.submission_data || {}).length > 6 && (
                            <p className="text-[9px] text-gray-400 mt-2">+{Object.keys(s.submission_data).length - 6} more fields</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Contact Detail Slideout */}
      {showContactDetail && (
        <ContactDetail
          contactId={showContactDetail}
          onClose={() => setShowContactDetail(null)}
          onUpdate={() => {}}
        />
      )}
    </div>
  )
}
