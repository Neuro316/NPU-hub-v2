'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import ContactDetail from '@/components/crm/contact-detail'
import {
  FileCheck, Plus, Search, Wand2, X, Save, Loader2, Eye, FileText,
  ClipboardList, Download, Trash2, Users, Check,
  Mic, MicOff, ExternalLink, Sparkles,
  PenLine, BookOpen, User, Upload,
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  List, ListOrdered, Heading1, Heading2, Heading3, Code, Undo2, Redo2,
  Link2, Table, Minus, IndentDecrease, IndentIncrease, Pilcrow, Eraser
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
  const [creatorMode, setCreatorMode] = useState<'generate' | 'upload'>('generate')
  const [uploadedText, setUploadedText] = useState('')
  const [uploadFileName, setUploadFileName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Edit
  const [editHtml, setEditHtml] = useState('')
  const [editName, setEditName] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editMode, setEditMode] = useState<'visual' | 'source'>('visual')
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)

  // Fill
  const [fillData, setFillData] = useState<Record<string, any>>({})
  const [fillContact, setFillContact] = useState('')
  const [fillContactId, setFillContactId] = useState('')
  const [contactSearch, setContactSearch] = useState('')
  const [contactResults, setContactResults] = useState<any[]>([])
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

  const filteredTemplates = templates.filter(t => !search.trim() || t.name.toLowerCase().includes(search.toLowerCase()) || t.form_type.includes(search.toLowerCase()))

  /* ─── File Upload ─── */
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    setUploadFileName(file.name)
    if (file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => { setUploadedText(`[IMAGE_BASE64:${file.type}:${(reader.result as string).split(',')[1]}]`) }
      reader.readAsDataURL(file)
    } else {
      const text = await file.text()
      if (text.length > 50) setUploadedText(text)
      else {
        const reader = new FileReader()
        reader.onload = () => { setUploadedText(`[PDF_BASE64:${(reader.result as string).split(',')[1]}]`) }
        reader.readAsDataURL(file)
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  /* ─── AI Generate ─── */
  const generateForm = async () => {
    if (!currentOrg) return; setAiProcessing(true)
    const isUpload = creatorMode === 'upload' && uploadedText.trim()
    const isImage = uploadedText.startsWith('[IMAGE_BASE64:')
    const typeDesc: Record<string, string> = {
      consent: 'Create a professional clinical consent form. Include: Practice header ("{PRACTICE_NAME}"), services description, risks/benefits, HIPAA notice, right to withdraw, signature/witness/guardian lines.',
      intake: 'Create a comprehensive clinical intake form. Include: Personal info, insurance, medical/mental/neurological history, family history, goals, sleep/exercise/substance use, prior neurofeedback experience, signatures.',
      assessment: 'Create a clinical assessment form. Include: Client info, presenting concerns, symptom severity scales (1-10), cognitive/emotional/sleep/stress assessments, physical symptoms checklist, clinician notes, recommendations.',
      custom: 'Create a professional clinical form based on the specific instructions provided.',
    }
    let userContent = isUpload
      ? (isImage ? `I'm uploading an image of an existing form. Recreate it as professional HTML, improving layout/styling while preserving all content and fields. ${aiPrompt || ''}` : `Recreate this existing form as professional HTML, improving layout/styling while preserving all content:\n\n---\n${uploadedText}\n---\n\n${aiPrompt ? 'Changes: ' + aiPrompt : ''}`)
      : `Generate a ${aiType} form.${aiPrompt ? ' ' + aiPrompt : ''}`
    const systemPrompt = `You are a clinical form designer for Sensorium Neuro Wellness / Neuro Progeny.\n\n${isUpload ? 'Recreate and improve the uploaded form as professional HTML.' : typeDesc[aiType]}\n\nRequirements:\n1. Clean modern styling with inline CSS\n2. Navy #1a365d headers, white body, subtle borders\n3. Proper form inputs with unique name attributes\n4. Print-friendly\n5. Medical language at 9th grade level\n6. Use "{PRACTICE_NAME}" placeholder\n7. Proper spacing/section dividers\n8. Footer with version/date\n${isUpload ? '9. Preserve ALL content/fields from original\n10. Improve styling and add missing standard fields' : ''}\n\nRespond with ONLY HTML. Start with <div class="form-container"> end with </div>. No markdown code blocks.`

    try {
      const messages: any[] = []
      if (isImage) {
        const parts = uploadedText.match(/\[IMAGE_BASE64:(.*?):(.*?)\]/)
        if (parts) messages.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: parts[1], data: parts[2] } }, { type: 'text', text: userContent }] })
      } else { messages.push({ role: 'user', content: userContent }) }

      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages, campaignContext: { systemOverride: systemPrompt } }) })
      const data = await res.json()
      let html = (data.content || data.message || data.text || '').replace(/```html?\n?/g, '').replace(/```\n?/g, '').trim()
      html = html.replace(/\{PRACTICE_NAME\}/g, currentOrg.name || 'Sensorium Neuro Wellness')

      if (html) {
        const name = aiName.trim() || `${FORM_TYPES.find(t => t.value === aiType)?.label || 'Form'} - ${new Date().toLocaleDateString()}`
        const { data: tpl, error } = await supabase.from('ehr_form_templates').insert({
          org_id: currentOrg.id, name, form_type: aiType,
          description: isUpload ? `Recreated from: ${uploadFileName}` : aiPrompt || `AI-generated ${aiType} form`,
          html_content: html, is_active: true, version: 1,
        }).select().single()
        if (error) alert('Save failed: ' + error.message)
        else {
          await load(); setSelectedTemplate(tpl)
          setEditHtml(html); setEditName(name); setEditDesc(tpl.description || '')
          setView('edit'); setEditMode('visual')
          setShowCreator(false); setAiPrompt(''); setAiName(''); setUploadedText(''); setUploadFileName('')
        }
      }
    } catch { alert('AI generation failed.') }
    setAiProcessing(false)
  }

  /* ─── Save edits ─── */
  const saveTemplate = async () => {
    if (!selectedTemplate || !currentOrg) return; setSaving(true)
    const html = editMode === 'visual' && editorRef.current ? editorRef.current.innerHTML : editHtml
    await supabase.from('ehr_form_templates').update({ name: editName, description: editDesc, html_content: html, version: selectedTemplate.version + 1, updated_at: new Date().toISOString() }).eq('id', selectedTemplate.id)
    setEditHtml(html); await load()
    setSelectedTemplate(prev => prev ? { ...prev, name: editName, description: editDesc, html_content: html, version: prev.version + 1 } : prev)
    setSaving(false)
  }
  const deleteTemplate = async (id: string) => { if (!confirm('Delete this form?')) return; await supabase.from('ehr_form_templates').delete().eq('id', id); if (selectedTemplate?.id === id) setSelectedTemplate(null); await load() }
  const searchContacts = async (q: string) => { setContactSearch(q); if (!q.trim() || !currentOrg) { setContactResults([]); return }; const { data } = await supabase.from('contacts').select('id, first_name, last_name, email').eq('org_id', currentOrg.id).or(`first_name.ilike.%${q}%,last_name.ilike.%${q}%,email.ilike.%${q}%`).limit(8); setContactResults(data || []) }
  const submitForm = async () => { if (!selectedTemplate || !currentOrg) return; setSaving(true); const { error } = await supabase.from('ehr_form_submissions').insert({ template_id: selectedTemplate.id, org_id: currentOrg.id, contact_id: fillContactId || null, contact_name: fillContact || 'Anonymous', submission_data: fillData, status: 'completed', signed_at: new Date().toISOString() }); if (error) alert('Failed: ' + error.message); else { alert('Submitted!'); setView('preview'); setFillData({}); setFillContact(''); setFillContactId(''); await load() }; setSaving(false) }
  const savePdfToLibrary = async () => { if (!selectedTemplate || !currentOrg) return; setSaving(true); try { await supabase.from('company_library').insert({ org_id: currentOrg.id, title: selectedTemplate.name + ' (Form)', description: `${selectedTemplate.form_type} form template.`, category: 'forms', content_type: 'form_template', content: selectedTemplate.html_content, created_by: user?.id, tags: [selectedTemplate.form_type, 'form'] }); alert('Saved to Library!') } catch { alert('Failed.') }; setSaving(false) }

  /* ─── Voice ─── */
  const startVoice = () => { const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; if (!SR) { alert('Use Chrome for voice.'); return }; const rec = new SR(); rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US'; let f = ''; rec.onresult = (e: any) => { let i = ''; for (let x = e.resultIndex; x < e.results.length; x++) { if (e.results[x].isFinal) f += e.results[x][0].transcript + ' '; else i += e.results[x][0].transcript }; setVoiceTranscript(f.trim() + (i ? ' ' + i : '')) }; rec.onerror = () => setIsRecording(false); recognitionRef.current = rec; setVoiceTranscript(''); setIsRecording(true); rec.start() }
  const stopVoice = () => { if (recognitionRef.current) { recognitionRef.current.stop(); recognitionRef.current = null }; setIsRecording(false); if (voiceTranscript.trim()) setAiPrompt(p => p + (p ? ' ' : '') + voiceTranscript.trim()); setVoiceTranscript('') }

  /* ─── Editor commands ─── */
  const exec = (cmd: string, val?: string) => { document.execCommand(cmd, false, val); editorRef.current?.focus() }
  const insertTable = () => exec('insertHTML', '<table style="width:100%;border-collapse:collapse;margin:12px 0" border="1"><tr><th style="border:1px solid #d1d5db;padding:8px;background:#f3f4f6;text-align:left">Header 1</th><th style="border:1px solid #d1d5db;padding:8px;background:#f3f4f6;text-align:left">Header 2</th><th style="border:1px solid #d1d5db;padding:8px;background:#f3f4f6;text-align:left">Header 3</th></tr><tr><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td></tr><tr><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td><td style="border:1px solid #d1d5db;padding:8px">&nbsp;</td></tr></table>')
  const insertField = (type: string) => { const id = 'f_' + Date.now(); const s = 'style="width:100%;padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;margin-top:4px"'; const html: Record<string, string> = { text: `<div style="margin:8px 0"><label style="font-size:12px;font-weight:600;color:#374151">Field Label</label><br/><input type="text" name="${id}" ${s} placeholder="Enter text..." /></div>`, textarea: `<div style="margin:8px 0"><label style="font-size:12px;font-weight:600;color:#374151">Field Label</label><br/><textarea name="${id}" ${s} rows="3"></textarea></div>`, checkbox: `<div style="margin:8px 0"><label style="font-size:12px;color:#374151;display:flex;align-items:center;gap:6px"><input type="checkbox" name="${id}" style="width:16px;height:16px" /> Checkbox label</label></div>`, date: `<div style="margin:8px 0"><label style="font-size:12px;font-weight:600;color:#374151">Date</label><br/><input type="date" name="${id}" ${s} /></div>`, select: `<div style="margin:8px 0"><label style="font-size:12px;font-weight:600;color:#374151">Select</label><br/><select name="${id}" ${s}><option>Option 1</option><option>Option 2</option><option>Option 3</option></select></div>`, signature: `<div style="margin:24px 0;padding-top:16px;border-top:1px solid #e5e7eb"><div style="display:flex;gap:32px"><div style="flex:1"><p style="font-size:11px;color:#6b7280;margin-bottom:4px">Signature</p><div style="border-bottom:1px solid #1a365d;height:32px"></div><p style="font-size:11px;color:#6b7280;margin-top:4px">Print Name</p></div><div style="width:160px"><p style="font-size:11px;color:#6b7280;margin-bottom:4px">Date</p><div style="border-bottom:1px solid #1a365d;height:32px"></div></div></div></div>`, section: `<div style="margin:20px 0;padding:16px;border:1px solid #e5e7eb;border-radius:8px"><h3 style="font-size:14px;font-weight:700;color:#1a365d;margin-bottom:8px;border-bottom:2px solid #1a365d;padding-bottom:4px">Section Title</h3><p style="font-size:13px;color:#374151">Content...</p></div>` }; exec('insertHTML', html[type] || '') }

  const selectForEdit = (t: FormTemplate) => { setSelectedTemplate(t); setEditHtml(t.html_content); setEditName(t.name); setEditDesc(t.description || ''); setView('edit'); setEditMode('visual') }
  const switchEditMode = (mode: 'visual' | 'source') => { if (mode === 'source' && editorRef.current) setEditHtml(editorRef.current.innerHTML); if (mode === 'visual') setTimeout(() => { if (editorRef.current) editorRef.current.innerHTML = editHtml }, 0); setEditMode(mode) }
  const extractFields = (html: string) => { const fields: { name: string; type: string; label: string }[] = []; if (typeof document === 'undefined') return fields; const d = document.createElement('div'); d.innerHTML = html; d.querySelectorAll('input, textarea, select').forEach(el => { const n = el.getAttribute('name'); if (!n) return; const t = el.getAttribute('type') || el.tagName.toLowerCase(); const label = n.replace(/[_-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); fields.push({ name: n, type: t, label }) }); return fields }

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>

  const TB = ({ icon: Icon, cmd, val, title, onClick }: { icon: any; cmd?: string; val?: string; title: string; onClick?: () => void }) => (
    <button onClick={onClick || (() => exec(cmd!, val))} title={title} type="button" className="p-1.5 rounded hover:bg-gray-200 text-gray-600 hover:text-np-dark transition-colors"><Icon className="w-3.5 h-3.5" /></button>
  )

  return (
    <div className="flex gap-4 h-[calc(100vh-6rem)]">
      {/* LEFT: Template List */}
      <div className="w-72 flex-shrink-0 bg-white border border-gray-100 rounded-2xl flex flex-col overflow-hidden">
        <div className="p-3 border-b border-gray-50">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-bold text-np-dark flex items-center gap-1.5"><FileCheck className="w-3.5 h-3.5 text-np-blue" /> Forms</h2>
            <button onClick={() => { setShowCreator(true); setCreatorMode('generate') }} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-white bg-np-blue rounded-md hover:bg-np-dark transition-colors"><Plus className="w-3 h-3" /> New</button>
          </div>
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-gray-300 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search forms..." className="w-full pl-8 pr-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filteredTemplates.length === 0 ? (
            <div className="p-6 text-center"><FileText className="w-8 h-8 text-gray-200 mx-auto mb-2" /><p className="text-xs text-gray-400">No forms yet</p><button onClick={() => setShowCreator(true)} className="text-[10px] text-np-blue hover:underline mt-1">Create first form</button></div>
          ) : filteredTemplates.map(t => { const ti = FORM_TYPES.find(ft => ft.value === t.form_type) || FORM_TYPES[3]; const Ic = ti.icon; const sc = submissions.filter(s => s.template_id === t.id).length; return (
            <button key={t.id} onClick={() => { setSelectedTemplate(t); setView('preview') }} className={`w-full text-left px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50 transition-colors ${selectedTemplate?.id === t.id ? 'bg-np-blue/5 border-l-2 border-l-np-blue' : ''}`}>
              <div className="flex items-start gap-2"><div className={`w-6 h-6 rounded-md ${ti.bg} flex items-center justify-center flex-shrink-0 mt-0.5`}><Ic className={`w-3 h-3 ${ti.color}`} /></div><div className="flex-1 min-w-0"><p className="text-xs font-semibold text-np-dark truncate">{t.name}</p><p className="text-[9px] text-gray-400 mt-0.5">{ti.label} · v{t.version}</p>{sc > 0 && <p className="text-[9px] text-np-blue mt-0.5">{sc} submission{sc !== 1 ? 's' : ''}</p>}</div></div>
            </button>) })}
        </div>
        <div className="p-2 border-t border-gray-50 text-center"><p className="text-[9px] text-gray-300">{templates.length} form{templates.length !== 1 ? 's' : ''}</p></div>
      </div>

      {/* MAIN */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {!selectedTemplate && !showCreator ? (
          <div className="flex-1 flex items-center justify-center bg-white border border-gray-100 rounded-2xl">
            <div className="text-center max-w-md">
              <FileCheck className="w-14 h-14 text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-np-dark mb-2">Consent & Intake Forms</h2>
              <p className="text-sm text-gray-400 mb-6">Create AI-powered forms or upload existing ones to recreate and improve.</p>
              <div className="flex items-center justify-center gap-3">
                <button onClick={() => { setShowCreator(true); setCreatorMode('generate') }} className="inline-flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white rounded-lg text-sm font-medium hover:bg-np-dark transition-colors"><Wand2 className="w-4 h-4" /> Create with AI</button>
                <button onClick={() => { setShowCreator(true); setCreatorMode('upload') }} className="inline-flex items-center gap-1.5 px-4 py-2 bg-white border border-gray-200 text-np-dark rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"><Upload className="w-4 h-4" /> Upload Existing</button>
              </div>
            </div>
          </div>

        ) : showCreator ? (
          <div className="flex-1 bg-white border border-gray-100 rounded-2xl overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-np-dark flex items-center gap-2"><Wand2 className="w-5 h-5 text-purple-500" /> AI Form Creator</h2>
                <button onClick={() => setShowCreator(false)} className="p-1.5 rounded hover:bg-gray-50"><X className="w-4 h-4 text-gray-400" /></button>
              </div>

              <div className="flex gap-1 mb-5 bg-gray-100 p-1 rounded-lg w-fit">
                <button onClick={() => setCreatorMode('generate')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${creatorMode === 'generate' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500'}`}><Sparkles className="w-3 h-3 inline mr-1" /> Generate New</button>
                <button onClick={() => setCreatorMode('upload')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${creatorMode === 'upload' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500'}`}><Upload className="w-3 h-3 inline mr-1" /> Upload & Recreate</button>
              </div>

              <div className="space-y-5">
                {creatorMode === 'upload' && (
                  <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">Upload Existing Form</label>
                    <div className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${uploadedText ? 'border-green-300 bg-green-50/30' : 'border-gray-200 hover:border-np-blue/40'}`}>
                      {uploadedText ? (
                        <div><Check className="w-8 h-8 text-green-500 mx-auto mb-2" /><p className="text-xs font-medium text-green-700">{uploadFileName}</p><p className="text-[10px] text-green-600 mt-1">{uploadedText.startsWith('[IMAGE') ? 'Image - AI will read form' : `${uploadedText.length.toLocaleString()} chars`}</p><button onClick={() => { setUploadedText(''); setUploadFileName('') }} className="text-[10px] text-red-500 hover:underline mt-2">Remove</button></div>
                      ) : (
                        <div><Upload className="w-8 h-8 text-gray-300 mx-auto mb-2" /><p className="text-xs text-gray-500 mb-1">Drop a file or click to upload</p><p className="text-[9px] text-gray-400">PDF, images (JPG/PNG), HTML, TXT</p>
                          <input ref={fileInputRef} type="file" accept=".pdf,.html,.htm,.txt,.jpg,.jpeg,.png,.webp" onChange={handleFileUpload} className="hidden" />
                          <button onClick={() => fileInputRef.current?.click()} className="mt-3 px-4 py-2 text-xs font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark transition-colors">Choose File</button>
                        </div>
                      )}
                    </div>
                    {!uploadedText && (
                      <div className="mt-3"><p className="text-[10px] font-medium text-gray-500 mb-1">Or paste content directly:</p>
                        <textarea value={uploadedText} onChange={e => { setUploadedText(e.target.value); setUploadFileName('pasted content') }} placeholder="Paste form text content here..." rows={6} className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-none font-mono" />
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 block">Form Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {FORM_TYPES.map(ft => (
                      <button key={ft.value} onClick={() => setAiType(ft.value as any)} className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all ${aiType === ft.value ? 'border-np-blue bg-np-blue/5 ring-1 ring-np-blue/20' : 'border-gray-200 hover:border-gray-300'}`}>
                        <div className={`w-8 h-8 rounded-lg ${ft.bg} flex items-center justify-center`}><ft.icon className={`w-4 h-4 ${ft.color}`} /></div>
                        <p className="text-xs font-semibold text-np-dark">{ft.label}</p>
                      </button>
                    ))}
                  </div>
                </div>

                <div><label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Form Name</label><input value={aiName} onChange={e => setAiName(e.target.value)} placeholder={creatorMode === 'upload' ? 'e.g. Patient Intake (Updated)' : 'e.g. General Treatment Consent'} className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>

                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">{creatorMode === 'upload' ? 'Edit Instructions' : 'Custom Instructions (optional)'}</label>
                  <div className="relative">
                    <textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder={creatorMode === 'upload' ? 'e.g. Add neurological history, modernize layout...' : 'Specific requirements, sections, language...'} rows={4} className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-200 resize-none" />
                    {isRecording && <div className="absolute inset-0 bg-red-50/90 rounded-lg flex items-center justify-center"><span className="w-3 h-3 rounded-full bg-red-500 animate-pulse inline-block mr-2" /><p className="text-[10px] text-red-600 font-medium">Recording... {voiceTranscript.slice(-60)}</p></div>}
                  </div>
                  <button onClick={() => isRecording ? stopVoice() : startVoice()} className={`mt-1.5 flex items-center gap-1 px-2 py-1 text-[10px] rounded-md transition-colors ${isRecording ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500 hover:bg-purple-100 hover:text-purple-600'}`}>
                    {isRecording ? <><MicOff className="w-3 h-3" /> Stop</> : <><Mic className="w-3 h-3" /> Voice</>}
                  </button>
                </div>

                <button onClick={generateForm} disabled={aiProcessing || (creatorMode === 'upload' && !uploadedText.trim())} className="w-full py-3 bg-purple-500 text-white text-sm font-medium rounded-xl hover:bg-purple-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                  {aiProcessing ? <><Loader2 className="w-4 h-4 animate-spin" /> {creatorMode === 'upload' ? 'Recreating...' : 'Generating...'}</> : <><Sparkles className="w-4 h-4" /> {creatorMode === 'upload' ? 'Recreate & Improve' : 'Generate Form'}</>}
                </button>
              </div>
            </div>
          </div>

        ) : selectedTemplate && (
          <>
            <div className="bg-white border border-gray-100 rounded-t-2xl px-5 py-3 flex items-center justify-between">
              <div><h2 className="text-sm font-bold text-np-dark">{selectedTemplate.name}</h2><p className="text-[10px] text-gray-400">{FORM_TYPES.find(t => t.value === selectedTemplate.form_type)?.label} · v{selectedTemplate.version}{selectedTemplate.description && ` · ${selectedTemplate.description}`}</p></div>
              <div className="flex items-center gap-1.5">
                {(['preview', 'edit', 'fill', 'submissions'] as const).map(v => (
                  <button key={v} onClick={() => { if (v === 'edit') selectForEdit(selectedTemplate); else setView(v) }} className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${view === v ? 'bg-np-blue text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                    {v === 'preview' ? 'Preview' : v === 'edit' ? 'Editor' : v === 'fill' ? 'Fill Out' : 'Submissions'}
                  </button>
                ))}
                <div className="w-px h-6 bg-gray-200 mx-1" />
                <button onClick={savePdfToLibrary} disabled={saving} title="Save to Library" className="p-1.5 text-gray-400 hover:text-np-blue rounded-lg hover:bg-gray-50"><BookOpen className="w-4 h-4" /></button>
                <button onClick={() => deleteTemplate(selectedTemplate.id)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-hidden border border-t-0 border-gray-100 rounded-b-2xl bg-white">
              {/* PREVIEW */}
              {view === 'preview' && (
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-xl shadow-sm p-8"><div dangerouslySetInnerHTML={{ __html: selectedTemplate.html_content }} /></div>
                  <div className="max-w-3xl mx-auto mt-4 flex items-center justify-center gap-3">
                    <button onClick={() => { const w = window.open('', '_blank'); if (w) { w.document.write(`<html><head><title>${selectedTemplate.name}</title><style>@media print{body{margin:0}}</style></head><body>${selectedTemplate.html_content}</body></html>`); w.document.close(); w.print() } }} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg transition-colors"><Download className="w-3.5 h-3.5" /> Print / PDF</button>
                    <button onClick={savePdfToLibrary} disabled={saving} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-np-blue bg-np-blue/5 hover:bg-np-blue/10 rounded-lg"><BookOpen className="w-3.5 h-3.5" /> Save to Library</button>
                    <button onClick={() => setView('fill')} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg"><PenLine className="w-3.5 h-3.5" /> Fill Out</button>
                  </div>
                </div>
              )}

              {/* RICH TEXT EDITOR */}
              {view === 'edit' && (
                <div className="h-full flex flex-col">
                  <div className="grid grid-cols-2 gap-3 px-4 pt-4 pb-2">
                    <div><label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Name</label><input value={editName} onChange={e => setEditName(e.target.value)} className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
                    <div><label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Description</label><input value={editDesc} onChange={e => setEditDesc(e.target.value)} className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
                  </div>
                  <div className="px-4 pb-2 flex items-center justify-between">
                    <div className="flex gap-1 bg-gray-100 p-0.5 rounded-md">
                      <button onClick={() => switchEditMode('visual')} className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${editMode === 'visual' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500'}`}><Eye className="w-3 h-3 inline mr-1" /> Visual</button>
                      <button onClick={() => switchEditMode('source')} className={`px-2.5 py-1 text-[10px] font-medium rounded transition-colors ${editMode === 'source' ? 'bg-white text-np-dark shadow-sm' : 'text-gray-500'}`}><Code className="w-3 h-3 inline mr-1" /> Source</button>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setView('preview')} className="px-3 py-1.5 text-xs text-gray-400">Cancel</button>
                      <button onClick={saveTemplate} disabled={saving} className="px-4 py-1.5 text-xs font-medium text-white bg-np-blue hover:bg-np-dark rounded-lg disabled:opacity-50 flex items-center gap-1">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save</button>
                    </div>
                  </div>

                  {editMode === 'visual' ? (<>
                    <div className="border-y border-gray-200 bg-gray-50 px-3 py-1.5 flex flex-wrap items-center gap-0.5">
                      <TB icon={Bold} cmd="bold" title="Bold" /><TB icon={Italic} cmd="italic" title="Italic" /><TB icon={Underline} cmd="underline" title="Underline" /><TB icon={Strikethrough} cmd="strikeThrough" title="Strikethrough" />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <TB icon={Heading1} cmd="formatBlock" val="h1" title="Heading 1" /><TB icon={Heading2} cmd="formatBlock" val="h2" title="Heading 2" /><TB icon={Heading3} cmd="formatBlock" val="h3" title="Heading 3" /><TB icon={Pilcrow} cmd="formatBlock" val="p" title="Paragraph" />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <TB icon={AlignLeft} cmd="justifyLeft" title="Left" /><TB icon={AlignCenter} cmd="justifyCenter" title="Center" /><TB icon={AlignRight} cmd="justifyRight" title="Right" />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <TB icon={List} cmd="insertUnorderedList" title="Bullets" /><TB icon={ListOrdered} cmd="insertOrderedList" title="Numbers" /><TB icon={IndentIncrease} cmd="indent" title="Indent" /><TB icon={IndentDecrease} cmd="outdent" title="Outdent" />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <TB icon={Minus} cmd="insertHorizontalRule" title="Line" /><TB icon={Table} title="Table" onClick={insertTable} /><TB icon={Link2} title="Link" onClick={() => { const u = prompt('URL:'); if (u) exec('createLink', u) }} />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <TB icon={Undo2} cmd="undo" title="Undo" /><TB icon={Redo2} cmd="redo" title="Redo" /><TB icon={Eraser} cmd="removeFormat" title="Clear Format" />
                      <div className="w-px h-5 bg-gray-300 mx-1" />
                      <select onChange={e => exec('fontSize', e.target.value)} defaultValue="3" title="Size" className="text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white">
                        <option value="1">XS</option><option value="2">S</option><option value="3">M</option><option value="4">L</option><option value="5">XL</option><option value="6">XXL</option>
                      </select>
                      <input type="color" defaultValue="#1a365d" onChange={e => exec('foreColor', e.target.value)} title="Text Color" className="w-6 h-6 rounded cursor-pointer border border-gray-200 ml-1" />
                      <input type="color" defaultValue="#ffffff" onChange={e => exec('hiliteColor', e.target.value)} title="Highlight" className="w-6 h-6 rounded cursor-pointer border border-gray-200" />
                    </div>
                    <div className="border-b border-gray-200 bg-gray-50/50 px-3 py-1.5 flex items-center gap-1.5">
                      <span className="text-[9px] font-bold text-gray-400 uppercase mr-1">Insert:</span>
                      {['text','textarea','checkbox','date','select','signature','section'].map(t => (
                        <button key={t} onClick={() => insertField(t)} className={`px-2 py-1 text-[10px] font-medium border rounded hover:border-np-blue hover:text-np-blue transition-colors ${t === 'section' ? 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100' : 'text-gray-500 bg-white border-gray-200'}`}>
                          {t === 'textarea' ? 'Text Area' : t.charAt(0).toUpperCase() + t.slice(1)}
                        </button>
                      ))}
                    </div>
                    <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
                      <div className="max-w-3xl mx-auto bg-white border border-gray-200 rounded-xl shadow-sm p-8 min-h-[600px]">
                        <div ref={editorRef} contentEditable suppressContentEditableWarning className="outline-none min-h-[500px]" style={{ fontSize: '13px', lineHeight: 1.6, fontFamily: 'system-ui, -apple-system, sans-serif' }} dangerouslySetInnerHTML={{ __html: editHtml }} />
                      </div>
                    </div>
                  </>) : (
                    <textarea value={editHtml} onChange={e => setEditHtml(e.target.value)} className="flex-1 mx-4 mb-4 px-4 py-3 text-[11px] font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20 resize-none bg-white text-np-dark" spellCheck={false} />
                  )}
                </div>
              )}

              {/* FILL */}
              {view === 'fill' && (
                <div className="h-full overflow-y-auto p-6"><div className="max-w-2xl mx-auto">
                  <div className="bg-np-blue/5 border border-np-blue/20 rounded-xl p-4 mb-5">
                    <p className="text-xs font-medium text-np-dark mb-2">Link to Contact</p>
                    <div className="relative">
                      <input value={contactSearch} onChange={e => { searchContacts(e.target.value); setFillContact(e.target.value) }} placeholder="Search contact..." className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                      {contactResults.length > 0 && <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 max-h-40 overflow-y-auto">
                        {contactResults.map(c => <button key={c.id} onClick={() => { setFillContact(`${c.first_name} ${c.last_name}`); setFillContactId(c.id); setContactResults([]); setContactSearch(`${c.first_name} ${c.last_name}`); setFillData(p => ({ ...p, first_name: c.first_name, last_name: c.last_name, email: c.email, patient_name: `${c.first_name} ${c.last_name}` })) }} className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 border-b border-gray-50"><span className="font-medium">{c.first_name} {c.last_name}</span>{c.email && <span className="text-gray-400 ml-2">{c.email}</span>}</button>)}
                      </div>}
                    </div>
                    {fillContactId && <button onClick={() => setShowContactDetail(fillContactId)} className="text-[10px] text-np-blue hover:underline mt-1.5 flex items-center gap-1"><ExternalLink className="w-3 h-3" /> View contact</button>}
                  </div>
                  <div className="bg-white border border-gray-200 rounded-xl p-8"><div dangerouslySetInnerHTML={{ __html: selectedTemplate.html_content }} /></div>
                  <div className="mt-4 p-4 bg-gray-50 rounded-xl">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Data Entry</p>
                    <div className="grid grid-cols-2 gap-3">
                      {(() => { const fields = extractFields(selectedTemplate.html_content); return fields.length > 0 ? fields.slice(0, 30).map(f => (
                        <div key={f.name} className={f.type === 'textarea' ? 'col-span-2' : ''}><label className="text-[9px] font-medium text-gray-500 uppercase mb-0.5 block">{f.label}</label>
                          {f.type === 'checkbox' ? <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!fillData[f.name]} onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.checked }))} className="accent-np-blue w-3.5 h-3.5" /> <span className="text-xs">Yes</span></label>
                          : f.type === 'textarea' ? <textarea value={fillData[f.name] || ''} onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.value }))} rows={2} className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />
                          : <input type={f.type === 'date' ? 'date' : 'text'} value={fillData[f.name] || ''} onChange={e => setFillData(d => ({ ...d, [f.name]: e.target.value }))} className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" />}
                        </div>
                      )) : <p className="col-span-2 text-[10px] text-gray-400 italic">No fields detected.</p> })()}
                      <div className="col-span-2"><label className="text-[9px] font-medium text-gray-500 uppercase mb-0.5 block">Notes</label><textarea value={fillData._notes || ''} onChange={e => setFillData(d => ({ ...d, _notes: e.target.value }))} rows={3} placeholder="Additional notes..." className="w-full px-3 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-np-blue/20" /></div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4"><button onClick={() => setView('preview')} className="px-3 py-2 text-xs text-gray-400">Cancel</button><button onClick={submitForm} disabled={saving} className="px-4 py-2 text-xs font-medium text-white bg-green-500 hover:bg-green-600 rounded-lg disabled:opacity-50 flex items-center gap-1.5">{saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Submit</button></div>
                </div></div>
              )}

              {/* SUBMISSIONS */}
              {view === 'submissions' && (
                <div className="h-full overflow-y-auto p-5">
                  <h3 className="text-sm font-bold text-np-dark mb-4">Submissions ({submissions.filter(s => s.template_id === selectedTemplate.id).length})</h3>
                  {submissions.filter(s => s.template_id === selectedTemplate.id).length === 0 ? (
                    <div className="text-center py-12"><Users className="w-10 h-10 text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">No submissions</p><button onClick={() => setView('fill')} className="text-xs text-np-blue hover:underline mt-2">Fill out form</button></div>
                  ) : submissions.filter(s => s.template_id === selectedTemplate.id).map(s => (
                    <div key={s.id} className="border border-gray-100 rounded-xl p-4 hover:border-np-blue/20 transition-colors mb-2">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2"><User className="w-4 h-4 text-gray-400" /><span className="text-xs font-semibold text-np-dark">{s.contact_name || 'Anonymous'}</span>{s.contact_id && <button onClick={() => setShowContactDetail(s.contact_id!)} className="text-[9px] text-np-blue hover:underline">View</button>}</div>
                        <div className="flex items-center gap-2"><span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${s.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>{s.status}</span><span className="text-[9px] text-gray-400">{new Date(s.created_at).toLocaleDateString()}</span></div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2">{Object.entries(s.submission_data || {}).filter(([k]) => !k.startsWith('_')).slice(0, 6).map(([k, v]) => <div key={k}><p className="text-[8px] text-gray-400 uppercase">{k.replace(/[_-]/g, ' ')}</p><p className="text-[10px] text-np-dark truncate">{String(v) || '--'}</p></div>)}</div>
                      {Object.keys(s.submission_data || {}).length > 6 && <p className="text-[9px] text-gray-400 mt-2">+{Object.keys(s.submission_data).length - 6} more</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showContactDetail && <ContactDetail contactId={showContactDetail} onClose={() => setShowContactDetail(null)} onUpdate={() => {}} />}
    </div>
  )
}
