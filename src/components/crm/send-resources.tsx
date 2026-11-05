'use client'

// Send resources (Build 2): every active library file as a checkbox, the discovery
// follow-up defaults pre-checked, a "Send from" mailbox, an editable subject and note, a
// preview, then Send. A person always presses Send. Shown only to superadmins (the API
// answers 403 to everyone else, and the panel then hides).
//
//   SendResources         the contact card's Resources section
//   SendResourcesOverlay  the same form over a live call, opened from the call panels: a
//                         dialog on desktop, a bottom sheet on a phone. The call keeps
//                         running underneath; nothing navigates.
//   SendResourcesToast    the short "Sent" line the call panels show afterwards
//
// "Send from" lists the mailboxes the signed-in user may see: their own private ones and
// the shared ones. It starts on cameron.allen@ for Cameron and on ops@ for anyone else
// (defaultFrom in src/lib/resources/plan.ts, chosen by the API).
//
// "Suggested from your call": when the panel opens, /api/resources/suggest is asked in the
// background for the files that fit the contact's latest transcribed call and a drafted
// note. The panel never waits for it. Suggested files are added to the checked ones and
// labelled; the drafted note replaces the standard one, with a link to switch back. A
// suggestion that arrives after the person has edited the files, the note or previewed is
// not applied over their edits. No answer, a slow one or an error shows nothing.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Eye, Loader2, CheckCircle2, AlertTriangle, Paperclip, Link2, FolderOpen, X, Sparkles } from 'lucide-react'
import { ResourceThumb } from '@/components/crm/resource-thumb'

interface Resource { id: string; name: string; description: string | null; file_name: string; mime_type: string; size_bytes: number; is_default_followup: boolean; thumb_url: string | null }
interface Summary { id: string; name: string; size_bytes: number }
interface SendRow { id: string; sent_by_name: string; from_address: string; to_address: string; subject: string; attached: Summary[]; linked: Summary[]; sent_at: string }
interface Mailbox { id: string; email_address: string; visibility: 'private' | 'shared'; usable: boolean; reason: string | null }
interface Panel {
  resources: Resource[]
  to: string | null
  mailboxes: Mailbox[]
  default_mailbox_id: string | null
  reason: string | null
  defaults: { subject: string; note: string; link_days: number }
  sends: SendRow[]
}
interface Suggestion { resource_ids: string[]; note: string | null; call_at: string }
interface Preview { from: string | null; to: string; subject: string; attached: Summary[]; linked: Summary[]; links_expire_at: string | null; text: string; can_send: boolean; reason: string | null }

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** The panel data for one contact; null while loading or when the caller may not use it. */
function usePanel(contactId: string) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [failed, setFailed] = useState(false)
  const load = () => {
    fetch(`/api/resources/send?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Panel | null) => { setPanel(d); setFailed(!d) })
      .catch(() => { setPanel(null); setFailed(true) })
  }
  useEffect(() => { setPanel(null); setFailed(false); load() }, [contactId]) // eslint-disable-line react-hooks/exhaustive-deps
  return { panel, failed, reload: load }
}

/** The form itself: Send from, files, subject, note, preview and Send. */
function SendForm({ contactId, panel, onCancel, onSent, roomy = false }: {
  contactId: string
  panel: Panel
  onCancel: () => void
  onSent: (text: string) => void
  roomy?: boolean
}) {
  const [checked, setChecked] = useState<string[]>(() => panel.resources.filter(r => r.is_default_followup).map(r => r.id))
  const [mailboxId, setMailboxId] = useState<string>(panel.default_mailbox_id ?? '')
  const [subject, setSubject] = useState(panel.defaults.subject)
  const [note, setNote] = useState(panel.defaults.note)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const [error, setError] = useState('')
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  // set once the person edits the files or the note, or previews: a late suggestion is then
  // shown as labels only and never overrides what they chose
  const edited = useRef({ files: false, note: false, previewed: false })

  // any edit invalidates the preview, so Send always follows a preview of what will go
  useEffect(() => { setPreview(null) }, [checked, subject, note, mailboxId])

  useEffect(() => {
    if (!panel.resources.length) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 25_000)
    fetch(`/api/resources/suggest?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store', signal: ctrl.signal })
      .then(r => (r.ok ? r.json() : null))
      .then((d: { suggestion: Suggestion | null } | null) => {
        const sg = d?.suggestion
        if (!sg) return
        setSuggestion(sg)
        if (edited.current.previewed) return
        if (!edited.current.files && sg.resource_ids.length) {
          setChecked(prev => [...prev, ...sg.resource_ids.filter(id => !prev.includes(id))])
        }
        if (!edited.current.note && sg.note) setNote(sg.note)
      })
      .catch(() => { /* no suggestion: the panel works as it always has */ })
      .finally(() => clearTimeout(timer))
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [contactId, panel]) // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(() => panel.resources.filter(r => checked.includes(r.id)).map(r => r.id), [panel, checked])
  const mailbox = panel.mailboxes.find(m => m.id === mailboxId) ?? null
  const text = roomy ? 'text-sm' : 'text-[11px]'
  const small = roomy ? 'text-xs' : 'text-[10px]'

  const post = async (send: boolean) => {
    setBusy(send ? 'send' : 'preview'); setError('')
    try {
      const res = await fetch('/api/resources/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, mailbox_id: mailboxId || null, resource_ids: ordered, subject, note, send }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(data.error || 'That did not work.'); return }
      if (!send) { edited.current.previewed = true; setPreview(data); return }
      onSent(`Sent to ${panel.to} from ${data.from}: ${data.attached} attached${data.linked ? `, ${data.linked} as links` : ''}.`)
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-2">
      {!panel.to && <p className={`${small} text-red-500`}>This contact has no usable email address.</p>}
      {panel.reason && <p className={`${small} text-amber-600`}>{panel.reason}</p>}
      {error && <p className={`flex items-center gap-1 ${small} text-red-600`}><AlertTriangle size={11} /> {error}</p>}

      {panel.mailboxes.length > 0 && (
        <label className={`flex items-center gap-2 ${small} text-gray-500`}>
          <span className="flex-shrink-0">Send from</span>
          <select value={mailboxId} onChange={e => setMailboxId(e.target.value)}
            className={`flex-1 min-w-0 px-2 py-1.5 ${text} text-np-dark border border-gray-100 rounded-lg bg-white`}>
            {!mailboxId && <option value="">Choose a mailbox</option>}
            {panel.mailboxes.map(m => (
              <option key={m.id} value={m.id} disabled={!m.usable}>
                {m.email_address}{m.visibility === 'shared' ? ' (shared)' : ''}{m.usable ? '' : ' (cannot send)'}
              </option>
            ))}
          </select>
        </label>
      )}
      {mailbox?.reason && <p className={`${small} text-amber-600`}>{mailbox.reason}</p>}

      {panel.resources.length === 0 ? (
        <p className={`${text} text-gray-400`}>The library is empty. Add files on the Resources page.</p>
      ) : (
        <div className="space-y-1">
          {panel.resources.map(r => (
            <label key={r.id} className={`flex items-center gap-2 ${text} text-np-dark cursor-pointer`}>
              <input type="checkbox" checked={checked.includes(r.id)} className="rounded border-gray-300"
                onChange={e => { edited.current.files = true; setChecked(prev => (e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id))) }} />
              <ResourceThumb url={r.thumb_url} mime={r.mime_type} fileName={r.file_name} name={r.name} size="sm" />
              <span className="flex-1 min-w-0">
                {r.name} <span className="text-gray-400">· {fmtSize(r.size_bytes)}</span>
                {suggestion?.resource_ids.includes(r.id) && (
                  <span className={`ml-1.5 inline-flex items-center gap-0.5 ${small} text-np-blue`}><Sparkles size={9} /> Suggested from your call</span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
      <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={250} placeholder="Subject"
        className={`w-full px-2 py-1.5 ${text} border border-gray-100 rounded-lg`} />
      <textarea value={note} onChange={e => { edited.current.note = true; setNote(e.target.value) }} maxLength={5000} rows={suggestion?.note ? 6 : 3}
        className={`w-full px-2 py-1.5 ${text} border border-gray-100 rounded-lg`} />
      {suggestion?.note && (
        <div className={`flex items-center gap-2 ${small} text-gray-400`}>
          {note === suggestion.note ? (
            <>
              <span className="flex items-center gap-0.5 text-np-blue"><Sparkles size={9} /> Note drafted from your call on {fmtWhen(suggestion.call_at)}</span>
              <button type="button" onClick={() => { edited.current.note = true; setNote(panel.defaults.note) }} className="underline hover:text-np-dark">Use standard note</button>
            </>
          ) : (
            <button type="button" onClick={() => { edited.current.note = true; setNote(suggestion.note!) }} className="underline hover:text-np-dark">Use note drafted from your call</button>
          )}
        </div>
      )}

      {preview && (
        <div className={`p-2 rounded-lg bg-gray-50 space-y-1 ${small} text-gray-600`}>
          <p><span className="text-gray-400">From</span> {preview.from ?? 'no mailbox'} <span className="text-gray-400">to</span> {preview.to}</p>
          <p><span className="text-gray-400">Subject</span> {preview.subject}</p>
          {preview.attached.length > 0 && (
            <p className="flex items-start gap-1"><Paperclip size={10} className="mt-0.5" /> Attached: {preview.attached.map(a => `${a.name} (${fmtSize(a.size_bytes)})`).join(', ')}</p>
          )}
          {preview.linked.length > 0 && preview.links_expire_at && (
            <p className="flex items-start gap-1 text-amber-700"><Link2 size={10} className="mt-0.5" />
              Too large to attach (over 20 MB together), sent as download links that expire {fmtWhen(preview.links_expire_at)}: {preview.linked.map(a => `${a.name} (${fmtSize(a.size_bytes)})`).join(', ')}
            </p>
          )}
          {preview.reason && <p className="text-amber-700">{preview.reason}</p>}
          <pre className={`whitespace-pre-wrap font-sans ${text} text-np-dark pt-1 border-t border-gray-100`}>{preview.text}</pre>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={onCancel} className={`${small} text-gray-400 hover:text-np-dark`}>Cancel</button>
        <div className="flex-1" />
        <button onClick={() => post(false)} disabled={!!busy || !ordered.length || !panel.to || !mailbox?.usable || !subject.trim() || !note.trim()}
          className={`flex items-center gap-1 px-2.5 py-1 ${small} font-medium text-np-dark border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40`}>
          {busy === 'preview' ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />} Preview
        </button>
        <button onClick={() => post(true)} disabled={!!busy || !preview || !preview.can_send}
          title={!preview ? 'Preview first' : preview.reason ?? ''}
          className={`flex items-center gap-1 px-2.5 py-1 ${small} font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark disabled:opacity-40`}>
          {busy === 'send' ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} Send
        </button>
      </div>
    </div>
  )
}

export function SendResources({ contactId }: { contactId: string }) {
  const { panel, reload } = usePanel(contactId)
  const [open, setOpen] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { setOpen(false); setNotice('') }, [contactId])

  if (!panel) return null

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Resources
        </h4>
        {!open && (
          <button onClick={() => { setOpen(true); setNotice('') }} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5">
            <Send size={10} /> Send resources
          </button>
        )}
      </div>

      {notice && (
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] bg-green-50 text-green-700">
          <CheckCircle2 size={11} /> {notice}
        </div>
      )}

      {open && (
        <div className="p-2.5 rounded-lg border border-gray-100">
          <SendForm contactId={contactId} panel={panel} onCancel={() => setOpen(false)}
            onSent={t => { setNotice(t); setOpen(false); reload() }} />
        </div>
      )}

      {panel.sends.length > 0 && (
        <div className="space-y-1">
          {panel.sends.map(s => (
            <div key={s.id} className="text-[10px] text-gray-500">
              <span className="text-np-dark">{[...s.attached, ...s.linked].map(f => f.name).join(', ')}</span>
              {' '}· {s.sent_by_name} from {s.from_address}, {fmtWhen(s.sent_at)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** The form over a live call: centered dialog on desktop, bottom sheet on a phone. */
export function SendResourcesOverlay({ contactId, onClose, onSent, zClass = 'z-[2050]' }: {
  contactId: string
  onClose: () => void
  onSent: (text: string) => void
  zClass?: string
}) {
  const { panel, failed } = usePanel(contactId)
  return (
    <div className={`fixed inset-0 ${zClass} flex items-end sm:items-center justify-center bg-black/40`} onClick={onClose}>
      <div role="dialog" aria-label="Send resources" onClick={e => e.stopPropagation()}
        className="w-full sm:max-w-md max-h-[85vh] overflow-y-auto bg-white text-np-dark rounded-t-2xl sm:rounded-2xl p-4 shadow-xl"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold"><FolderOpen size={14} /> Send resources</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg text-gray-400 hover:text-np-dark hover:bg-gray-50">
            <X size={16} />
          </button>
        </div>
        {panel ? (
          <SendForm contactId={contactId} panel={panel} roomy onCancel={onClose} onSent={t => { onSent(t); onClose() }} />
        ) : failed ? (
          <p className="text-sm text-gray-500">Resources are not available for this contact.</p>
        ) : (
          <p className="flex items-center gap-2 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading…</p>
        )}
      </div>
    </div>
  )
}

/** "Sent" confirmation for the call panels; clears itself after a few seconds. */
export function SendResourcesToast({ message, onDone, className = '' }: { message: string; onDone: () => void; className?: string }) {
  useEffect(() => { const t = setTimeout(onDone, 5000); return () => clearTimeout(t) }, [message]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div role="status" className={`flex items-center gap-1.5 px-3 py-2 rounded-xl bg-green-50 text-green-700 text-xs ${className}`}>
      <CheckCircle2 size={12} className="flex-shrink-0" /> <span className="min-w-0">{message}</span>
    </div>
  )
}
