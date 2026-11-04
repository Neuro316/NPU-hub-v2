'use client'

// Contact card › Send resources (Build 2). Every active library file as a checkbox, the
// discovery follow-up defaults pre-checked, an editable subject and note, a preview, then
// Send. Sends from cameron.allen@neuroprogeny.com; a person always presses Send. Shown
// only to superadmins (the API answers 403 to everyone else, and the panel then hides).
import { useEffect, useMemo, useState } from 'react'
import { Send, Eye, Loader2, CheckCircle2, AlertTriangle, Paperclip, Link2, FolderOpen } from 'lucide-react'

interface Resource { id: string; name: string; description: string | null; size_bytes: number; is_default_followup: boolean }
interface Summary { id: string; name: string; size_bytes: number }
interface SendRow { id: string; sent_by_name: string; to_address: string; subject: string; attached: Summary[]; linked: Summary[]; sent_at: string }
interface Panel {
  resources: Resource[]
  to: string | null
  from: string
  can_send: boolean
  reason: string | null
  defaults: { subject: string; note: string; link_days: number }
  sends: SendRow[]
}
interface Preview { from: string; to: string; subject: string; attached: Summary[]; linked: Summary[]; links_expire_at: string | null; text: string; can_send: boolean; reason: string | null }

const fmtSize = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function SendResources({ contactId }: { contactId: string }) {
  const [panel, setPanel] = useState<Panel | null>(null)
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [subject, setSubject] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'send' | null>(null)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => {
    fetch(`/api/resources/send?contact_id=${encodeURIComponent(contactId)}`, { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((d: Panel | null) => {
        setPanel(d)
        if (d) {
          setChecked(d.resources.filter(r => r.is_default_followup).map(r => r.id))
          setSubject(d.defaults.subject); setNote(d.defaults.note)
        }
      })
      .catch(() => setPanel(null))
  }

  useEffect(() => { setPanel(null); setPreview(null); setNotice(null); setOpen(false); load() }, [contactId]) // eslint-disable-line react-hooks/exhaustive-deps

  // any edit invalidates the preview, so Send always follows a preview of what will go
  useEffect(() => { setPreview(null) }, [checked, subject, note])

  const ordered = useMemo(() => (panel ? panel.resources.filter(r => checked.includes(r.id)).map(r => r.id) : []), [panel, checked])

  if (!panel) return null

  const post = async (send: boolean) => {
    setBusy(send ? 'send' : 'preview'); setNotice(null)
    try {
      const res = await fetch('/api/resources/send', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contact_id: contactId, resource_ids: ordered, subject, note, send }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setNotice({ ok: false, text: data.error || 'That did not work.' }); return }
      if (!send) { setPreview(data); return }
      setNotice({ ok: true, text: `Sent to ${panel.to}: ${data.attached} attached${data.linked ? `, ${data.linked} as links` : ''}.` })
      setPreview(null); setOpen(false); load()
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Resources
        </h4>
        {!open && (
          <button onClick={() => setOpen(true)} className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-np-blue border border-np-blue/20 rounded-lg hover:bg-np-blue/5">
            <Send size={10} /> Send resources
          </button>
        )}
      </div>

      {notice && (
        <div className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] ${notice.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
          {notice.ok ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />} {notice.text}
        </div>
      )}

      {open && (
        <div className="p-2.5 rounded-lg border border-gray-100 space-y-2">
          {!panel.to && <p className="text-[10px] text-red-500">This contact has no usable email address.</p>}
          {panel.reason && <p className="text-[10px] text-amber-600">{panel.reason}</p>}
          {panel.resources.length === 0 ? (
            <p className="text-[11px] text-gray-400">The library is empty. Add files on the Resources page.</p>
          ) : (
            <div className="space-y-1">
              {panel.resources.map(r => (
                <label key={r.id} className="flex items-start gap-2 text-[11px] text-np-dark cursor-pointer">
                  <input type="checkbox" checked={checked.includes(r.id)} className="mt-0.5 rounded border-gray-300"
                    onChange={e => setChecked(prev => (e.target.checked ? [...prev, r.id] : prev.filter(x => x !== r.id)))} />
                  <span className="flex-1">{r.name} <span className="text-gray-400">· {fmtSize(r.size_bytes)}</span></span>
                </label>
              ))}
            </div>
          )}
          <input value={subject} onChange={e => setSubject(e.target.value)} maxLength={250} placeholder="Subject"
            className="w-full px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg" />
          <textarea value={note} onChange={e => setNote(e.target.value)} maxLength={5000} rows={3}
            className="w-full px-2 py-1.5 text-[11px] border border-gray-100 rounded-lg" />

          {preview && (
            <div className="p-2 rounded-lg bg-gray-50 space-y-1 text-[10px] text-gray-600">
              <p><span className="text-gray-400">From</span> {preview.from} <span className="text-gray-400">to</span> {preview.to}</p>
              <p><span className="text-gray-400">Subject</span> {preview.subject}</p>
              {preview.attached.length > 0 && (
                <p className="flex items-start gap-1"><Paperclip size={10} className="mt-0.5" /> Attached: {preview.attached.map(a => `${a.name} (${fmtSize(a.size_bytes)})`).join(', ')}</p>
              )}
              {preview.linked.length > 0 && preview.links_expire_at && (
                <p className="flex items-start gap-1 text-amber-700"><Link2 size={10} className="mt-0.5" />
                  Too large to attach (over 20 MB together), sent as download links that expire {fmtWhen(preview.links_expire_at)}: {preview.linked.map(a => `${a.name} (${fmtSize(a.size_bytes)})`).join(', ')}
                </p>
              )}
              <pre className="whitespace-pre-wrap font-sans text-[11px] text-np-dark pt-1 border-t border-gray-100">{preview.text}</pre>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button onClick={() => { setOpen(false); setPreview(null) }} className="text-[10px] text-gray-400 hover:text-np-dark">Cancel</button>
            <div className="flex-1" />
            <button onClick={() => post(false)} disabled={!!busy || !ordered.length || !panel.to || !subject.trim() || !note.trim()}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium text-np-dark border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40">
              {busy === 'preview' ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />} Preview
            </button>
            <button onClick={() => post(true)} disabled={!!busy || !preview || !preview.can_send}
              title={!preview ? 'Preview first' : preview.reason ?? ''}
              className="flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium bg-np-blue text-white rounded-lg hover:bg-np-dark disabled:opacity-40">
              {busy === 'send' ? <Loader2 size={10} className="animate-spin" /> : <Send size={10} />} Send
            </button>
          </div>
        </div>
      )}

      {panel.sends.length > 0 && (
        <div className="space-y-1">
          {panel.sends.map(s => (
            <div key={s.id} className="text-[10px] text-gray-500">
              <span className="text-np-dark">{[...s.attached, ...s.linked].map(f => f.name).join(', ')}</span>
              {' '}· {s.sent_by_name}, {fmtWhen(s.sent_at)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
