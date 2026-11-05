'use client'

// "Add name" for a contact created by calling its number (call-new-number.ts).
// Shown on the call screens during and after the call, and on the contact's
// card. Never in the way of the call: it is a small link until tapped.

import { useState } from 'react'
import { Check, Loader2, UserPlus } from 'lucide-react'
import { updateContact } from '@/lib/crm-client'
import { splitName } from '@/lib/call-new-number'
import { useOutboundCall } from '@/lib/voice-outbound-context'

export function AddNamePrompt({ contactId, onSaved, tone = 'light', className = '' }: {
  contactId: string
  onSaved?: (name: string) => void
  /** 'dark' on the green or dark call screens. */
  tone?: 'light' | 'dark'
  className?: string
}) {
  const { setTargetName } = useOutboundCall()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dark = tone === 'dark'

  const save = async () => {
    const full = name.trim()
    if (!full || saving) return
    setSaving(true)
    setError('')
    try {
      await updateContact(contactId, splitName(full))
      setTargetName(contactId, full)
      setOpen(false)
      onSaved?.(full)
    } catch (e: any) {
      setError(e?.message || 'Could not save the name.')
    } finally {
      setSaving(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
          dark ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-np-blue/10 text-np-blue hover:bg-np-blue/20'
        } ${className}`}>
        <UserPlus size={12} /> Add name
      </button>
    )
  }
  return (
    <form onSubmit={e => { e.preventDefault(); save() }} className={`flex flex-col gap-1 ${className}`}>
      <div className="flex items-center gap-1.5">
        <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="First and last name"
          autoComplete="off" aria-label="Contact name"
          className={`min-w-0 flex-1 rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 ${
            dark ? 'border-white/30 bg-white/10 text-white placeholder-white/60 focus:ring-white/40'
              : 'border-gray-200 bg-white text-np-dark placeholder-gray-400 focus:ring-np-blue/30'
          }`} />
        <button type="submit" disabled={!name.trim() || saving} aria-label="Save name"
          className={`flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-50 ${
            dark ? 'bg-white text-np-dark' : 'bg-np-blue text-white hover:bg-np-dark'
          }`}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
        </button>
      </div>
      {error && <p role="alert" className={`text-[11px] ${dark ? 'text-red-100' : 'text-red-600'}`}>{error}</p>}
    </form>
  )
}
