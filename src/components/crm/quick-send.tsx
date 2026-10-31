'use client'

// Quick Send: pick documents from the Media Library and email them to a contact.
//
//   QuickSendDialog  desktop: centered over a dimmed page, from the contact view or
//                    the call controls
//   QuickSendSheet   phone: slides up over the current screen (the live call stays
//                    up behind it, its status line visible above the sheet)
//   QuickSendButton  the contact view's button beside Call and Text; opens the
//                    dialog on desktop and the sheet on a phone
//
// Opening either one never navigates: it renders over whatever is on screen, so a
// live call and its audio are untouched. Sending is a single POST
// (submitQuickSend); the server re-checks everything. Only resources marked
// Available to send are listed (scope=send).

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { updateContact } from '@/lib/crm-client'
import { useIsNarrowCallScreen } from '@/components/incoming-call-banner'
import {
  groupByCategory, fileTypeLabel, defaultQuickSendNote, firstNameOf, sendButtonLabel,
  attachmentsSelectedLabel, checkAttachmentSize, isValidEmail, submitQuickSend,
  type QuickSendCategory, type QuickSendResource,
} from '@/lib/quick-send'

interface SendData {
  categories: QuickSendCategory[]
  resources: QuickSendResource[]
  contact: { id: string; first_name: string | null; last_name: string | null; email: string | null } | null
  sender: { name: string; email: string | null }
  settings: { from_email: string; from_name: string } | null
}

function useQuickSendData(orgId: string | undefined, contactId: string) {
  const [data, setData] = useState<SendData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!orgId) return
    let cancelled = false
    setData(null); setError('')
    fetch(`/api/quick-send/resources?org_id=${encodeURIComponent(orgId)}&scope=send&contact_id=${encodeURIComponent(contactId)}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) setError(j?.error || 'Quick Send could not load. Try again.')
        else setData(j as SendData)
      })
      .catch(() => { if (!cancelled) setError('Quick Send could not load. Check the connection.') })
    return () => { cancelled = true }
  }, [orgId, contactId])
  return { data, error, setData }
}

/** The form shared by the dialog and the sheet. */
function useQuickSendForm(orgId: string | undefined, contactId: string, onSent: (msg: string) => void) {
  const { data, error: loadError, setData } = useQuickSendData(orgId, contactId)
  const [selected, setSelected] = useState<string[]>([])
  const [to, setTo] = useState('')
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  // Prefill once per load. Saving a missing email updates `data` again, and that
  // must fill To without wiping a note already edited.
  const prefilled = useRef(false)
  useEffect(() => {
    if (!data) return
    if (!to) setTo(data.contact?.email || '')
    if (prefilled.current) return
    prefilled.current = true
    setNote(defaultQuickSendNote(data.contact?.first_name, firstNameOf(data.sender?.name)))
  }, [data])  // eslint-disable-line react-hooks/exhaustive-deps

  const firstName = data?.contact?.first_name?.trim() || ''
  const groups = useMemo(() => data ? groupByCategory(data.resources, data.categories) : [], [data])
  const chosen = (data?.resources || []).filter(r => selected.includes(r.media_asset_id))
  const size = checkAttachmentSize(chosen.map(r => r.file_size || 0))
  const hasEmail = !!data?.contact?.email
  const toValid = isValidEmail(to)
  const canSend = !!data && !!data.settings && chosen.length > 0 && hasEmail && toValid && size.ok && !sending

  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])

  const saveEmail = async () => {
    const email = newEmail.trim()
    if (!isValidEmail(email) || !data?.contact) { setError('Enter a valid email address.'); return }
    setSavingEmail(true); setError('')
    try {
      await updateContact(data.contact.id, { email } as any)
      setData({ ...data, contact: { ...data.contact, email } })
      setNewEmail('')
    } catch (e: any) {
      setError(`The email could not be saved: ${e?.message || 'unknown error'}`)
    } finally { setSavingEmail(false) }
  }

  const send = async () => {
    if (!canSend || !orgId) return
    setSending(true); setError('')
    const res = await submitQuickSend(fetch, {
      org_id: orgId, contact_id: contactId, media_asset_ids: chosen.map(r => r.media_asset_id), to_email: to.trim(), note,
    })
    setSending(false)
    if (!res.ok) { setError(res.error); return }
    onSent(res.warning ? `Sent to ${firstName || res.to}. ${res.warning}` : `Sent to ${firstName || res.to}`)
  }

  return {
    data, loadError, groups, selected, toggle, chosen, size, to, setTo, toValid, note, setNote,
    hasEmail, newEmail, setNewEmail, saveEmail, savingEmail, send, sending, canSend, error, firstName,
  }
}

type Form = ReturnType<typeof useQuickSendForm>

function ResourceRows({ form }: { form: Form }) {
  if (form.loadError) return <p role="alert" className="text-sm text-red-700">{form.loadError}</p>
  if (!form.data) {
    return <p className="flex items-center gap-2 py-6 text-sm text-gray-400"><Loader2 size={14} className="animate-spin" /> Loading resources…</p>
  }
  if (!form.groups.length) {
    return (
      <p className="rounded-xl bg-gray-50 px-3 py-4 text-sm text-gray-500">
        No resources are available to send yet. Add them in CRM Settings, Quick Send Resources, or turn on
        Available in Quick Send for an item in the Media Library.
      </p>
    )
  }
  return (
    <div className="space-y-4">
      {form.groups.map(g => (
        <fieldset key={g.category.id}>
          <legend className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g.category.name}</legend>
          <div className="space-y-1.5">
            {g.resources.map(r => {
              const on = form.selected.includes(r.media_asset_id)
              return (
                <label key={r.media_asset_id}
                  className={`flex min-h-[48px] w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                    on ? 'border-np-blue bg-np-blue/5' : 'border-gray-200 hover:bg-gray-50'}`}>
                  <input type="checkbox" checked={on} onChange={() => form.toggle(r.media_asset_id)}
                    className="h-5 w-5 flex-shrink-0 accent-np-blue" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-np-dark break-words">{r.name}</span>
                    {r.description && <span className="block text-xs text-gray-500 truncate">{r.description}</span>}
                  </span>
                  <span className="flex-shrink-0 rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-bold text-gray-500">
                    {fileTypeLabel(r.name, r.mime_type)}
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>
      ))}
    </div>
  )
}

function Notices({ form }: { form: Form }) {
  return (
    <>
      {form.data && !form.data.settings && (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
          Quick Send has no From address yet. An admin can set it in CRM Settings, Quick Send Resources.
        </p>
      )}
      {!form.size.ok && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.size.message}</p>
      )}
      {form.error && (
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{form.error}</p>
      )}
    </>
  )
}

/** Shown in place of the To field when the contact has no email: Send stays off until one is saved. */
function AddEmail({ form }: { form: Form }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
      <p className="text-sm text-gray-600">{form.firstName || 'This contact'} has no email address. Add one to send.</p>
      <div className="mt-2 flex gap-2">
        <input type="email" inputMode="email" autoComplete="off" value={form.newEmail}
          onChange={e => form.setNewEmail(e.target.value)} placeholder="name@example.com" aria-label="Contact email"
          className="h-11 min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 text-base text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 md:text-sm" />
        <button type="button" onClick={form.saveEmail} disabled={form.savingEmail || !isValidEmail(form.newEmail)}
          className="h-11 flex-shrink-0 rounded-lg bg-np-blue px-4 text-sm font-semibold text-white hover:bg-np-blue-dark disabled:opacity-40">
          {form.savingEmail ? 'Saving…' : 'Save email'}
        </button>
      </div>
    </div>
  )
}

export function QuickSendDialog({ contactId, onClose, onSent }: {
  contactId: string
  onClose: () => void
  onSent?: (message: string) => void
}) {
  const { currentOrg } = useWorkspace()
  const form = useQuickSendForm(currentOrg?.id, contactId, msg => { onSent?.(msg); onClose() })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !form.sending) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [form.sending, onClose])
  const n = form.chosen.length

  return (
    <div className="fixed inset-0 z-[2050] flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!form.sending) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="quick-send-title" onClick={e => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id="quick-send-title" className="text-base font-bold text-np-dark">Quick Send to {form.firstName || 'this contact'}</h2>
            <p className="mt-0.5 text-xs text-gray-500">Only resources marked Available to send are listed.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <ResourceRows form={form} />
          {form.data && (
            <>
              {form.hasEmail ? (
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">To</span>
                  <input type="email" value={form.to} onChange={e => form.setTo(e.target.value)}
                    className={`mt-1 h-11 w-full rounded-lg border px-3 text-sm text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30 ${
                      form.to && !form.toValid ? 'border-red-300' : 'border-gray-200'}`} />
                </label>
              ) : <AddEmail form={form} />}
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Note</span>
                <textarea value={form.note} onChange={e => form.setNote(e.target.value)} rows={5}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm leading-relaxed text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
              </label>
            </>
          )}
          <Notices form={form} />
        </div>

        <div className="flex items-center gap-3 border-t border-gray-100 px-5 py-3">
          <span className="flex-1 text-xs text-gray-500">{attachmentsSelectedLabel(n)}</span>
          <button type="button" onClick={onClose} disabled={form.sending}
            className="h-11 rounded-lg px-4 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
          <button type="button" onClick={form.send} disabled={!form.canSend}
            className="flex h-11 items-center gap-2 rounded-lg bg-np-blue px-4 text-sm font-semibold text-white hover:bg-np-blue-dark disabled:opacity-40">
            {form.sending && <Loader2 size={14} className="animate-spin" />}
            {form.sending ? 'Sending…' : sendButtonLabel(n)}
          </button>
        </div>
      </div>
    </div>
  )
}

export function QuickSendSheet({ contactId, onClose, onSent, closeLabel = 'Back to call', zClass = 'z-[2050]' }: {
  contactId: string
  onClose: () => void
  onSent?: (message: string) => void
  closeLabel?: string
  /** Above whichever full-screen call layout it opens over. */
  zClass?: string
}) {
  const { currentOrg } = useWorkspace()
  const form = useQuickSendForm(currentOrg?.id, contactId, msg => { onSent?.(msg); onClose() })
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  const n = form.chosen.length
  const email = form.data?.contact?.email || ''

  return (
    <div className={`fixed inset-0 ${zClass}`}>
      {/* Light dim only: the call screen's status line stays readable above the sheet. */}
      <div className="absolute inset-0 bg-black/30" onClick={() => { if (!form.sending) onClose() }} />
      <div role="dialog" aria-modal="true" aria-labelledby="quick-send-sheet-title"
        className={`absolute inset-x-0 bottom-0 flex max-h-[78vh] flex-col rounded-t-2xl bg-white text-np-dark shadow-2xl transition-transform duration-200 ease-out ${shown ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="px-4 pt-2">
          <div className="mx-auto h-1 w-10 rounded-full bg-gray-200" />
          <div className="mt-2 flex items-center gap-2">
            <h2 id="quick-send-sheet-title" className="min-w-0 flex-1 truncate text-base font-bold">
              Quick Send to {form.firstName || 'this contact'}
            </h2>
            <button type="button" onClick={onClose} disabled={form.sending}
              className="flex h-11 items-center px-2 text-sm font-semibold text-np-blue">{closeLabel}</button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 pb-3 pt-1 overscroll-contain">
          <ResourceRows form={form} />
          {form.data && (
            form.hasEmail ? (
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 break-all">Note to {email}</span>
                <textarea value={form.note} onChange={e => form.setNote(e.target.value)} rows={4}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-base leading-relaxed focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
              </label>
            ) : <AddEmail form={form} />
          )}
          <Notices form={form} />
        </div>

        <div className="border-t border-gray-100 px-4 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
          <button type="button" onClick={form.send} disabled={!form.canSend}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-np-blue text-base font-semibold text-white active:scale-[0.99] disabled:bg-gray-200 disabled:text-gray-500">
            {form.sending && <Loader2 size={16} className="animate-spin" />}
            {form.sending ? 'Sending…' : sendButtonLabel(n, { sheet: true })}
          </button>
        </div>
      </div>
    </div>
  )
}

/** A short confirmation after a send ("Sent to Jane"). */
export function QuickSendToast({ message, onDone, className = '' }: { message: string; onDone: () => void; className?: string }) {
  const done = useRef(onDone)
  done.current = onDone
  useEffect(() => { const t = setTimeout(() => done.current(), 4000); return () => clearTimeout(t) }, [message])
  return (
    <div role="status" aria-live="polite"
      className={`flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-np-dark shadow-lg ${className}`}>
      <CheckCircle2 size={16} className="text-green-600" /> {message}
    </div>
  )
}

/** The contact view's Quick Send button, beside Call and Text. */
export function QuickSendButton({ contactId, onSent }: { contactId: string; onSent?: () => void }) {
  const narrow = useIsNarrowCallScreen()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState('')
  const sent = (msg: string) => { setToast(msg); onSent?.() }
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Email resources to this contact"
        className="flex items-center gap-1 rounded bg-fire-light px-2.5 py-1.5 transition-colors hover:bg-fire/20 max-md:min-h-[44px]">
        <FileText size={13} className="text-fire-warm" />
        <span className="text-[10px] font-medium text-np-dark">Quick Send</span>
      </button>
      {open && (narrow
        ? <QuickSendSheet contactId={contactId} onClose={() => setOpen(false)} onSent={sent} closeLabel="Close" />
        : <QuickSendDialog contactId={contactId} onClose={() => setOpen(false)} onSent={sent} />)}
      {toast && (
        <div className="fixed inset-x-0 bottom-6 z-[2060] flex justify-center px-4">
          <QuickSendToast message={toast} onDone={() => setToast('')} />
        </div>
      )}
    </>
  )
}
