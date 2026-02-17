'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  X, Send, Sparkles, Paperclip, Bold, Italic, Underline, List, Link2,
  ChevronDown, FileText, Loader2, Type, Undo2, Image, AlertCircle
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { useWorkspace } from '@/lib/workspace-context'
import type { CrmContact } from '@/types/crm'

interface PipelineResource {
  id: string
  name: string
  description?: string
  file_url?: string
  file_type?: string
  pipeline_stage: string
}

interface EmailComposerProps {
  contact: CrmContact
  onClose: () => void
  onSent?: () => void
  initialSubject?: string
  initialBody?: string
  attachResource?: PipelineResource | null
}

export default function EmailComposer({
  contact, onClose, onSent,
  initialSubject = '', initialBody = '',
  attachResource = null,
}: EmailComposerProps) {
  const supabase = createClient()
  const { currentOrg } = useWorkspace()
  const editorRef = useRef<HTMLDivElement>(null)

  const [subject, setSubject] = useState(initialSubject)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [fromEmail, setFromEmail] = useState('')
  const [fromName, setFromName] = useState('')
  const [resources, setResources] = useState<PipelineResource[]>([])
  const [attachedResources, setAttachedResources] = useState<PipelineResource[]>(attachResource ? [attachResource] : [])
  const [showResources, setShowResources] = useState(false)
  const [showMergeTags, setShowMergeTags] = useState(false)
  const [aiDrafting, setAiDrafting] = useState(false)
  const [aiContext, setAiContext] = useState('')
  const [showAiPanel, setShowAiPanel] = useState(false)

  // Load email config + pipeline resources
  useEffect(() => {
    if (!currentOrg) return

    // Email config
    supabase.from('org_email_config').select('*').eq('org_id', currentOrg.id).maybeSingle()
      .then(({ data }) => {
        if (data) {
          setFromEmail(data.sending_email || '')
          setFromName(data.sending_name || '')
        }
      })

    // Pipeline resources for this contact's stage
    supabase.from('pipeline_resources')
      .select('*')
      .eq('org_id', currentOrg.id)
      .eq('is_active', true)
      .order('sort_order')
      .then(({ data }) => {
        if (data) setResources(data)
      })
  }, [currentOrg?.id])

  // Set initial body
  useEffect(() => {
    if (editorRef.current && initialBody) {
      editorRef.current.innerHTML = initialBody
    }
  }, [initialBody])

  const MERGE_TAGS = [
    { tag: '{{first_name}}', label: 'First Name', preview: contact.first_name },
    { tag: '{{last_name}}', label: 'Last Name', preview: contact.last_name },
    { tag: '{{email}}', label: 'Email', preview: contact.email },
    { tag: '{{phone}}', label: 'Phone', preview: contact.phone },
    { tag: '{{pipeline_stage}}', label: 'Pipeline Stage', preview: contact.pipeline_stage },
    { tag: '{{org_name}}', label: 'Org Name', preview: currentOrg?.name },
  ]

  const stageResources = resources.filter(r => r.pipeline_stage === contact.pipeline_stage)
  const allOtherResources = resources.filter(r => r.pipeline_stage !== contact.pipeline_stage)

  const execCommand = (cmd: string, value?: string) => {
    document.execCommand(cmd, false, value)
    editorRef.current?.focus()
  }

  const insertMergeTag = (tag: string) => {
    execCommand('insertHTML', `<span class="bg-np-blue/10 text-np-blue px-1 rounded text-xs font-mono">${tag}</span>&nbsp;`)
    setShowMergeTags(false)
  }

  const insertResourceLink = (resource: PipelineResource) => {
    if (resource.file_url) {
      execCommand('insertHTML', `<a href="${resource.file_url}" style="color:#386797;text-decoration:underline;">${resource.name}</a>&nbsp;`)
    }
    if (!attachedResources.find(r => r.id === resource.id)) {
      setAttachedResources(prev => [...prev, resource])
    }
    setShowResources(false)
  }

  const removeAttachment = (id: string) => {
    setAttachedResources(prev => prev.filter(r => r.id !== id))
  }

  const handleAiDraft = async () => {
    if (!currentOrg) return
    setAiDrafting(true)
    setError('')
    try {
      const res = await fetch('/api/email/ai-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          org_id: currentOrg.id,
          context: aiContext || undefined,
          pipeline_stage: contact.pipeline_stage,
          attached_resources: attachedResources.map(r => r.name),
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'AI draft failed'); setAiDrafting(false); return }

      if (data.subject && !subject) setSubject(data.subject)
      if (data.body_html && editorRef.current) {
        editorRef.current.innerHTML = data.body_html
      }
      setShowAiPanel(false)
    } catch {
      setError('AI draft failed')
    }
    setAiDrafting(false)
  }

  const handleSend = async () => {
    if (!subject.trim() || !editorRef.current?.innerHTML.trim() || !currentOrg) return
    setSending(true)
    setError('')

    // Build HTML body with resource links
    let bodyHtml = editorRef.current.innerHTML

    if (attachedResources.length > 0) {
      bodyHtml += '<br/><hr style="border:none;border-top:1px solid #eee;margin:16px 0;"/>'
      bodyHtml += '<p style="font-size:12px;color:#666;margin-bottom:8px;"><strong>Attached Resources:</strong></p>'
      bodyHtml += '<ul style="margin:0;padding-left:16px;">'
      for (const r of attachedResources) {
        if (r.file_url) {
          bodyHtml += `<li style="margin-bottom:4px;"><a href="${r.file_url}" style="color:#386797;">${r.name}</a>${r.description ? ` - ${r.description}` : ''}</li>`
        } else {
          bodyHtml += `<li style="margin-bottom:4px;">${r.name}${r.description ? ` - ${r.description}` : ''}</li>`
        }
      }
      bodyHtml += '</ul>'
    }

    try {
      const res = await fetch('/api/email/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          contact_id: contact.id,
          subject,
          body_html: bodyHtml,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Send failed'); setSending(false); return }

      // Increment email counter
      try {
        const { data: cur } = await supabase.from('contacts')
          .select('total_emails').eq('id', contact.id).single()
        if (cur) {
          await supabase.from('contacts').update({
            total_emails: (cur.total_emails || 0) + 1,
            last_email_at: new Date().toISOString(),
            last_contacted_at: new Date().toISOString(),
          }).eq('id', contact.id)
        }
      } catch (e) { console.warn('Email counter skipped:', e) }

      setSuccess(true)
      setTimeout(() => { onSent?.(); onClose() }, 1200)
    } catch {
      setError('Network error')
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50/50">
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4 text-amber-600" />
            <span className="text-sm font-semibold text-np-dark">Compose Email</span>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {/* From / To */}
        <div className="px-4 py-2 border-b border-gray-50 space-y-1">
          <div className="flex items-center text-[11px]">
            <span className="text-gray-400 w-12">From:</span>
            <span className="font-medium text-np-dark">
              {fromName ? `${fromName} <${fromEmail}>` : fromEmail || 'Not configured'}
            </span>
            {!fromEmail && (
              <span className="ml-2 text-[9px] text-amber-500 flex items-center gap-0.5">
                <AlertCircle className="w-3 h-3" /> Configure in CRM Settings &gt; Email
              </span>
            )}
          </div>
          <div className="flex items-center text-[11px]">
            <span className="text-gray-400 w-12">To:</span>
            <span className="font-medium text-np-dark">{contact.first_name} {contact.last_name} &lt;{contact.email}&gt;</span>
          </div>
        </div>

        {/* Subject */}
        <div className="px-4 py-2 border-b border-gray-50">
          <input
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject line..."
            className="w-full text-sm font-medium text-np-dark bg-transparent border-none outline-none placeholder-gray-300"
          />
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-100 bg-gray-50/30 flex-wrap">
          <button onClick={() => execCommand('bold')} className="p-1.5 rounded hover:bg-gray-100" title="Bold"><Bold className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => execCommand('italic')} className="p-1.5 rounded hover:bg-gray-100" title="Italic"><Italic className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => execCommand('underline')} className="p-1.5 rounded hover:bg-gray-100" title="Underline"><Underline className="w-3.5 h-3.5 text-gray-500" /></button>
          <div className="w-px h-4 bg-gray-200 mx-1" />
          <button onClick={() => execCommand('insertUnorderedList')} className="p-1.5 rounded hover:bg-gray-100" title="Bullet List"><List className="w-3.5 h-3.5 text-gray-500" /></button>
          <button onClick={() => {
            const url = prompt('Enter URL:')
            if (url) execCommand('createLink', url)
          }} className="p-1.5 rounded hover:bg-gray-100" title="Insert Link"><Link2 className="w-3.5 h-3.5 text-gray-500" /></button>
          <div className="w-px h-4 bg-gray-200 mx-1" />

          {/* Merge Tags */}
          <div className="relative">
            <button onClick={() => { setShowMergeTags(!showMergeTags); setShowResources(false) }}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-[10px] text-gray-500">
              <Type className="w-3 h-3" /> Merge Tags <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {showMergeTags && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-56 py-1">
                {MERGE_TAGS.map(t => (
                  <button key={t.tag} onClick={() => insertMergeTag(t.tag)}
                    className="w-full text-left px-3 py-1.5 hover:bg-gray-50 flex justify-between items-center">
                    <span className="text-[10px] font-medium text-np-dark">{t.label}</span>
                    <span className="text-[9px] text-gray-400 font-mono">{t.tag}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Attach Resource */}
          <div className="relative">
            <button onClick={() => { setShowResources(!showResources); setShowMergeTags(false) }}
              className="flex items-center gap-1 px-2 py-1 rounded hover:bg-gray-100 text-[10px] text-gray-500">
              <Paperclip className="w-3 h-3" /> Resources <ChevronDown className="w-2.5 h-2.5" />
            </button>
            {showResources && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-10 w-72 max-h-60 overflow-y-auto">
                {stageResources.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[8px] font-bold text-np-blue uppercase tracking-wider bg-np-blue/5">
                      {contact.pipeline_stage} Resources
                    </div>
                    {stageResources.map(r => (
                      <button key={r.id} onClick={() => insertResourceLink(r)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] font-medium text-np-dark">{r.name}</p>
                            {r.description && <p className="text-[9px] text-gray-400 line-clamp-1">{r.description}</p>}
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
                {allOtherResources.length > 0 && (
                  <>
                    <div className="px-3 py-1.5 text-[8px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50">
                      Other Stages
                    </div>
                    {allOtherResources.map(r => (
                      <button key={r.id} onClick={() => insertResourceLink(r)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-50">
                        <div className="flex items-center gap-2">
                          <FileText className="w-3 h-3 text-gray-300 flex-shrink-0" />
                          <div>
                            <p className="text-[10px] text-gray-500">{r.name}</p>
                            <p className="text-[8px] text-gray-300">{r.pipeline_stage}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </>
                )}
                {resources.length === 0 && (
                  <div className="px-3 py-4 text-center text-[10px] text-gray-400">
                    No resources uploaded yet. Add them in CRM Settings.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex-1" />

          {/* AI Draft */}
          <button onClick={() => setShowAiPanel(!showAiPanel)}
            className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 text-[10px] font-medium text-purple-600 transition-all">
            <Sparkles className="w-3 h-3" /> AI Draft
          </button>
        </div>

        {/* AI Draft Panel */}
        {showAiPanel && (
          <div className="px-4 py-3 bg-gradient-to-r from-purple-50/50 to-blue-50/50 border-b border-purple-100/50">
            <p className="text-[10px] font-semibold text-purple-600 mb-1.5">AI Email Assistant</p>
            <textarea
              value={aiContext}
              onChange={e => setAiContext(e.target.value)}
              rows={2}
              placeholder="What should this email be about? e.g. 'Follow up on their Discovery call, share the intake form resource, mention next steps for enrollment...'"
              className="w-full text-[11px] border border-purple-100 rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-purple-300 bg-white/80 mb-2"
            />
            <div className="flex gap-2">
              <button onClick={handleAiDraft} disabled={aiDrafting}
                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-[10px] font-medium rounded-md disabled:opacity-40 hover:bg-purple-700 transition-colors">
                {aiDrafting ? <><Loader2 className="w-3 h-3 animate-spin" /> Drafting...</> : <><Sparkles className="w-3 h-3" /> Generate Draft</>}
              </button>
              <button onClick={() => setShowAiPanel(false)} className="px-2 py-1 text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
            </div>
          </div>
        )}

        {/* Editor */}
        <div className="flex-1 overflow-y-auto px-4 py-3 min-h-[200px]">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            className="min-h-[180px] text-sm text-np-dark focus:outline-none prose prose-sm max-w-none"
            style={{ lineHeight: '1.6' }}
            onFocus={() => { setShowMergeTags(false); setShowResources(false) }}
          />
        </div>

        {/* Attached Resources */}
        {attachedResources.length > 0 && (
          <div className="px-4 py-2 border-t border-gray-50 bg-gray-50/30">
            <p className="text-[8px] font-bold text-gray-400 uppercase tracking-wider mb-1">Attached Resources</p>
            <div className="flex flex-wrap gap-1.5">
              {attachedResources.map(r => (
                <span key={r.id} className="flex items-center gap-1 px-2 py-0.5 bg-white border border-gray-200 rounded-md text-[10px] group">
                  <FileText className="w-3 h-3 text-gray-400" />
                  <span className="text-np-dark">{r.name}</span>
                  <button onClick={() => removeAttachment(r.id)} className="opacity-0 group-hover:opacity-100">
                    <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Error / Success */}
        {error && (
          <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-100 rounded-md text-[10px] text-red-600 flex items-center gap-1.5">
            <AlertCircle className="w-3 h-3 flex-shrink-0" /> {error}
          </div>
        )}
        {success && (
          <div className="mx-4 mb-2 px-3 py-2 bg-green-50 border border-green-100 rounded-md text-[10px] text-green-600">
            Email sent successfully!
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50/50">
          <div className="text-[9px] text-gray-400">
            Sending from <span className="font-medium">{fromEmail || 'not configured'}</span>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-[11px] text-gray-400 hover:text-gray-600">Discard</button>
            <button onClick={handleSend} disabled={sending || !subject.trim() || !fromEmail}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-np-blue text-white text-[11px] font-medium rounded-md disabled:opacity-40 hover:bg-np-dark transition-colors">
              {sending ? <><Loader2 className="w-3 h-3 animate-spin" /> Sending...</> : <><Send className="w-3 h-3" /> Send Email</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
