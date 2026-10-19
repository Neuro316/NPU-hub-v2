'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Phone, PhoneOff, PhoneCall, PhoneOutgoing, Mic, MicOff, Grid3x3, Volume2, X, Search,
  UserPlus, ChevronDown, Loader2, AlertTriangle, Delete,
} from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'
import { createContact } from '@/lib/crm-client'
import { useWorkspace } from '@/lib/workspace-context'
import { usePermissions } from '@/lib/hooks/use-permissions'
import { useOrgLines } from '@/lib/hooks/use-org-lines'
import { formatUsPhone, toE164 } from '@/lib/phone'
import { primeCallTones, unlockCallAudio } from '@/lib/voice-audio'
import { useOutboundCall, ALREADY_ON_CALL_MESSAGE, type OutboundTarget } from '@/lib/voice-outbound-context'
import { useIsNarrowCallScreen } from '@/components/incoming-call-banner'

// The Call button at the top of every Hub page, and the live outbound call's
// indicator and controls. Rendered once, in the top-right cluster of the
// dashboard layout (incoming-call-banner.tsx), so it is on every page.
//
//   idle       Call opens the quick-dial sheet (bottom sheet on a phone, a
//              popover on desktop): search contacts by name or number, type a
//              number on the pad, pick the line, call. A typed number that is
//              no contact gets "Add contact and call": the contact is created
//              first, so every call is logged against a contact.
//   live call  The button becomes the in-call indicator (name or number and a
//              timer). Tapping it opens the controls: Mute, Keypad, Speaker
//              where supported, Hang up. On a phone that is the same
//              full-screen layout as the incoming call overlay.
//
// The call itself lives in OutboundCallProvider, not here, so pages can change
// underneath it without ending it.

/** Who can place calls in the Hub today: anyone who can open the CRM, on a
 *  browser that can make WebRTC calls. */
export function useCanPlaceCalls(): boolean {
  const { currentOrg, hiddenModules } = useWorkspace()
  const { canView, loading } = usePermissions()
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    setSupported(typeof window !== 'undefined'
      && !!navigator.mediaDevices?.getUserMedia
      && typeof RTCPeerConnection !== 'undefined')
  }, [])
  return supported && !!currentOrg && !loading && canView('crm') && !(hiddenModules || []).includes('crm')
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const DIAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function targetLabel(t: OutboundTarget | null): string {
  if (!t) return ''
  return t.name || formatUsPhone(t.phone) || t.phone
}

export function GlobalCallButton() {
  const canCall = useCanPlaceCalls()
  const narrow = useIsNarrowCallScreen()
  const { snapshot, live } = useOutboundCall()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [notice, setNotice] = useState('')
  // The session this button placed, so its failure is reported here.
  const placedRef = useRef(0)

  // When the call ends: close the controls; if a call placed here failed, say why.
  const endedSession = snapshot.ended?.session ?? 0
  useEffect(() => {
    if (!endedSession) return
    setControlsOpen(false)
    if (endedSession === placedRef.current && snapshot.ended?.error) setNotice(snapshot.ended.error)
  }, [endedSession])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!canCall) return null

  const onPlaced = (session: number) => {
    placedRef.current = session
    setSheetOpen(false)
    setNotice('')
    setControlsOpen(true)
  }

  return (
    <div className="relative">
      {live
        ? <InCallIndicator narrow={narrow} onClick={() => setControlsOpen(o => !o)} />
        : (
          <button
            type="button"
            onClick={() => { setSheetOpen(o => !o); setNotice('') }}
            aria-haspopup="dialog"
            aria-expanded={sheetOpen}
            className={narrow
              ? 'flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-np-blue text-white text-sm font-semibold shadow-sm active:scale-95'
              : 'flex items-center gap-1.5 rounded-full bg-np-blue hover:bg-np-dark text-white px-2.5 py-1 text-[10px] font-semibold shadow-sm'}
          >
            <Phone size={narrow ? 15 : 11} /> Call
          </button>
        )}

      {sheetOpen && !live && (
        <QuickDialSheet narrow={narrow} onClose={() => setSheetOpen(false)} onPlaced={onPlaced} />
      )}
      {controlsOpen && live && (
        narrow
          ? <MobileOutboundOverlay onMinimize={() => setControlsOpen(false)} />
          : <DesktopCallControls onClose={() => setControlsOpen(false)} />
      )}
      {notice && !live && !sheetOpen && (
        <div role="alert" className={`${narrow ? 'fixed inset-x-3 top-16' : 'absolute right-0 top-full mt-2 w-80'} z-[1001] rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 shadow-lg`}>
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <p className="flex-1">{notice}</p>
            <button type="button" onClick={() => setNotice('')} className="font-semibold underline">Dismiss</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── In-call indicator ───────────────────────────────────────────────────────

function useCallStatusText(): string {
  const { snapshot } = useOutboundCall()
  const now = useTick(snapshot.stage === 'connected')
  switch (snapshot.stage) {
    case 'dialing': return 'Calling…'
    case 'ringing': return 'Ringing…'
    case 'ending': return 'Hanging up…'
    case 'connected': {
      const s = snapshot.connectedAt ? Math.max(0, Math.floor((now - snapshot.connectedAt) / 1000)) : 0
      return mmss(s)
    }
    default: return ''
  }
}

function InCallIndicator({ narrow, onClick }: { narrow: boolean; onClick: () => void }) {
  const { snapshot } = useOutboundCall()
  const status = useCallStatusText()
  const connected = snapshot.stage === 'connected'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Call with ${targetLabel(snapshot.target)}, ${status}. Open call controls`}
      className={`flex items-center gap-1.5 rounded-full text-white font-semibold shadow-sm max-w-[60vw] ${
        connected ? 'bg-green-600 hover:bg-green-700' : 'bg-np-dark hover:bg-np-dark/90'
      } ${narrow ? 'h-9 px-3.5 text-sm active:scale-95' : 'px-2.5 py-1 text-[10px]'}`}
    >
      <span className="relative flex flex-shrink-0">
        {connected ? <PhoneCall size={narrow ? 15 : 11} /> : <PhoneOutgoing size={narrow ? 15 : 11} className="animate-pulse" />}
      </span>
      <span className="truncate">{targetLabel(snapshot.target)}</span>
      <span className="font-mono font-normal opacity-80 flex-shrink-0">{status}</span>
    </button>
  )
}

// ── Quick dial ──────────────────────────────────────────────────────────────

interface FoundContact { id: string; first_name: string | null; last_name: string | null; phone: string | null }

const contactName = (c: FoundContact) => `${c.first_name || ''} ${c.last_name || ''}`.trim()
const last10 = (raw: string) => { const d = raw.replace(/\D/g, ''); return d.length > 10 ? d.slice(-10) : d }

// The Conversations line picker's remembered choice (crm/conversations/page.tsx).
const conversationsLineKey = (orgId: string) => `npu_hub_conversations_line:${orgId}`

function QuickDialSheet({ narrow, onClose, onPlaced }: {
  narrow: boolean
  onClose: () => void
  onPlaced: (session: number) => void
}) {
  const { currentOrg } = useWorkspace()
  const { placeCall } = useOutboundCall()
  const { lines } = useOrgLines(currentOrg?.id)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<FoundContact[]>([])
  const [numberMatch, setNumberMatch] = useState<FoundContact | null>(null)
  const [searching, setSearching] = useState(false)
  const [showPad, setShowPad] = useState(false)
  const [line, setLine] = useState('')
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!narrow) inputRef.current?.focus() }, [narrow])

  // Line: the same default as the Conversations picker. Its remembered line
  // when that is one of this org's lines, else the server's default caller ID
  // (what the contact Call buttons use).
  useEffect(() => {
    if (!currentOrg || lines.length < 2) { setLine(''); return }
    let stored = ''
    try { stored = localStorage.getItem(conversationsLineKey(currentOrg.id)) || '' } catch { /* private mode */ }
    setLine(lines.some(l => l.phone === stored) ? stored : '')
  }, [currentOrg?.id, lines])  // eslint-disable-line react-hooks/exhaustive-deps

  const digits = query.replace(/\D/g, '')
  const typedE164 = digits.length >= 10 ? toE164(query) : null

  // Search this org's contacts by name, and by number (last 10 digits, the
  // same match inbound calls and the Dialer use, so formatting never matters).
  useEffect(() => {
    const q = query.trim()
    setNumberMatch(null)
    if (!currentOrg || q.length < 2) { setResults([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      setSearching(true)
      const sb = createClient()
      const safe = q.replace(/[%,()*\\]/g, ' ').trim()
      const found: FoundContact[] = []
      try {
        if (/[a-z]/i.test(safe)) {
          const { data } = await sb.from('contacts')
            .select('id, first_name, last_name, phone')
            .eq('org_id', currentOrg.id)
            .is('merged_into_id', null)
            .is('do_not_contact', false)
            .not('phone', 'is', null)
            .or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`)
            .limit(15)
          found.push(...((data || []) as FoundContact[]))
        }
        if (digits.length >= 7) {
          const { data } = await sb.from('contacts')
            .select('id, first_name, last_name, phone')
            .eq('org_id', currentOrg.id)
            .is('merged_into_id', null)
            .not('phone', 'is', null)
            .filter('phone', 'neq', '')
          const want = last10(digits)
          const byNumber = ((data || []) as FoundContact[]).filter(c => {
            const have = last10(c.phone || '')
            return want.length >= 10 ? have === want : have.includes(want)
          })
          if (!cancelled && want.length >= 10) setNumberMatch(byNumber[0] ?? null)
          for (const c of byNumber.slice(0, 15)) if (!found.some(f => f.id === c.id)) found.push(c)
        }
      } catch { /* search is best effort; typing a full number still works */ }
      if (!cancelled) { setResults(found.slice(0, 20)); setSearching(false) }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, currentOrg?.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const call = (c: FoundContact) => {
    setError('')
    const res = placeCall({ contactId: c.id, name: contactName(c), phone: c.phone || '', lineE164: line || null })
    if (!res.ok) { setError(ALREADY_ON_CALL_MESSAGE); return }
    onPlaced(res.session)
  }

  const addAndCall = async () => {
    if (!currentOrg || !typedE164 || adding) return
    // Inside the tap, before the contact insert awaits: phones only allow
    // call audio and the ringback tone to start in a gesture.
    unlockCallAudio()
    primeCallTones()
    setAdding(true)
    setError('')
    try {
      const parts = newName.trim().split(/\s+/).filter(Boolean)
      // Same minimal payload as the Contacts page's create. No name: the
      // "Unknown" placeholder an unknown inbound caller gets, mergeable later.
      const contact = await createContact({
        org_id: currentOrg.id,
        first_name: parts[0] || 'Unknown',
        last_name: parts.slice(1).join(' '),
        phone: typedE164,
        tags: [],
        sms_consent: false,
        do_not_contact: false,
      } as any)
      const res = placeCall({
        contactId: contact.id,
        name: parts.length ? contactName(contact as any) : '',
        phone: typedE164,
        lineE164: line || null,
      })
      if (!res.ok) { setError(ALREADY_ON_CALL_MESSAGE); return }
      onPlaced(res.session)
    } catch (e: any) {
      setError(`Could not add the contact: ${e?.message || 'unknown error'}`)
    } finally {
      setAdding(false)
    }
  }

  const press = (d: string) => { setQuery(q => q + d); inputRef.current?.focus() }

  const body = (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-np-dark">Place a call</p>
        <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <X size={16} />
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          ref={inputRef}
          value={query}
          onChange={e => { setQuery(e.target.value); setError('') }}
          placeholder="Name or number"
          inputMode={showPad ? 'none' : 'text'}
          autoComplete="off"
          className={`w-full rounded-xl border border-gray-200 bg-white pl-9 pr-9 text-np-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-np-blue/30 ${narrow ? 'h-11 text-base' : 'h-9 text-sm'}`}
        />
        {query && (
          <button type="button" onClick={() => setQuery(q => q.slice(0, -1))} aria-label="Delete last character"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
            <Delete size={15} />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setShowPad(p => !p)} aria-pressed={showPad}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium ${showPad ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
          <Grid3x3 size={13} /> {showPad ? 'Hide number pad' : 'Number pad'}
        </button>
        {lines.length >= 2 && (
          <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-500">
            From
            <select value={line} onChange={e => setLine(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs text-np-dark focus:outline-none focus:ring-2 focus:ring-np-blue/30">
              <option value="">Default line</option>
              {lines.map(l => <option key={l.phone} value={l.phone}>{l.nickname || formatUsPhone(l.phone)}</option>)}
            </select>
          </label>
        )}
      </div>

      {showPad && (
        <div className="grid grid-cols-3 gap-2">
          {DIAL_KEYS.map(d => (
            <button key={d} type="button" onClick={() => press(d)}
              className={`rounded-xl bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-np-dark font-light select-none ${narrow ? 'h-12 text-xl' : 'h-9 text-base'}`}>
              {d}
            </button>
          ))}
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 border border-red-100 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
        {searching && results.length === 0 && (
          <p className="flex items-center gap-1.5 px-1 py-2 text-xs text-gray-400"><Loader2 size={12} className="animate-spin" /> Searching…</p>
        )}
        {results.map(c => (
          <div key={c.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-gray-50">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-np-dark truncate">{contactName(c) || 'Unnamed contact'}</p>
              <p className="text-[11px] text-gray-400 font-mono">{formatUsPhone(c.phone || '') || c.phone}</p>
            </div>
            <button type="button" onClick={() => call(c)} aria-label={`Call ${contactName(c) || c.phone}`}
              className={`flex items-center justify-center rounded-full bg-green-500 hover:bg-green-600 text-white shadow-sm active:scale-95 ${narrow ? 'h-11 w-11' : 'h-8 w-8'}`}>
              <Phone size={narrow ? 18 : 14} />
            </button>
          </div>
        ))}
        {!searching && query.trim().length >= 2 && results.length === 0 && !typedE164 && (
          <p className="px-1 py-2 text-xs text-gray-400">No contacts match. Type a full number to add one and call.</p>
        )}
      </div>

      {typedE164 && !numberMatch && !searching && (
        <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 flex flex-col gap-2">
          <p className="text-xs text-gray-600">
            <span className="font-mono font-semibold text-np-dark">{formatUsPhone(typedE164)}</span> is not in your contacts.
          </p>
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Name (optional)" autoComplete="off"
            className={`w-full rounded-lg border border-gray-200 bg-white px-3 text-np-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-np-blue/30 ${narrow ? 'h-11 text-base' : 'h-8 text-sm'}`} />
          <button type="button" onClick={addAndCall} disabled={adding}
            className={`flex items-center justify-center gap-2 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-semibold active:scale-[0.98] ${narrow ? 'h-12 text-base' : 'h-9 text-sm'}`}>
            {adding ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
            Add contact and call
          </button>
        </div>
      )}
    </div>
  )

  if (narrow) {
    return (
      <div className="fixed inset-0 z-[1500]" role="dialog" aria-modal="true" aria-label="Place a call">
        <div className="absolute inset-0 bg-black/40" onClick={onClose} />
        <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-2xl bg-white px-4 pt-3 shadow-2xl"
          style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}>
          <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-200" />
          {body}
        </div>
      </div>
    )
  }
  return (
    <div role="dialog" aria-label="Place a call"
      className="absolute right-0 top-full mt-2 w-80 rounded-xl border border-gray-100 bg-white p-4 shadow-xl">
      {body}
    </div>
  )
}

// ── Controls for the live outbound call ─────────────────────────────────────

function useSpeaker() {
  const { outputDevices, outputDeviceId, setOutputDevice } = useOutboundCall()
  const canSpeaker = outputDevices.length > 1
  const current = outputDevices.find(d => d.id === outputDeviceId) ?? outputDevices[0]
  const next = () => {
    if (!canSpeaker) return
    const i = outputDevices.findIndex(d => d.id === outputDeviceId)
    setOutputDevice(outputDevices[(i + 1) % outputDevices.length].id)
  }
  return { canSpeaker, label: current?.label || 'Speaker', next }
}

function DesktopCallControls({ onClose }: { onClose: () => void }) {
  const { snapshot, hangUp, setMuted, sendDigits } = useOutboundCall()
  const status = useCallStatusText()
  const speaker = useSpeaker()
  const [keypad, setKeypad] = useState(false)
  const [sent, setSent] = useState('')
  const connected = snapshot.stage === 'connected'
  const t = snapshot.target
  const btn = 'flex flex-col items-center justify-center gap-1 h-14 rounded-xl text-[10px] font-semibold'

  return (
    <div role="dialog" aria-label="Call controls"
      className="absolute right-0 top-full mt-2 w-72 rounded-xl border border-gray-100 bg-white p-4 shadow-xl">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{connected ? 'On call' : 'Outgoing call'}</p>
          <p className="text-sm font-bold text-np-dark truncate">{targetLabel(t)}</p>
          {t?.name && <p className="text-[11px] font-mono text-gray-400">{formatUsPhone(t.phone)}</p>}
          <p className={`text-xs font-mono mt-0.5 ${connected ? 'text-green-600' : 'text-gray-500'}`}>{status}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Hide call controls" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500">
          <X size={16} />
        </button>
      </div>

      {connected && keypad && (
        <div className="mt-3">
          <p className="min-h-[1.25rem] text-center font-mono text-sm tracking-widest text-np-dark">{sent}</p>
          <div className="grid grid-cols-3 gap-1.5 mt-1">
            {DIAL_KEYS.map(d => (
              <button key={d} type="button" onClick={() => { sendDigits(d); setSent(p => (p + d).slice(-20)) }}
                className="h-9 rounded-lg bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-base font-light">{d}</button>
            ))}
          </div>
        </div>
      )}

      <div className={`mt-3 grid gap-2 ${speaker.canSpeaker ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <button type="button" disabled={!connected} onClick={() => setMuted(!snapshot.muted)} aria-pressed={snapshot.muted}
          className={`${btn} disabled:opacity-40 ${snapshot.muted ? 'bg-amber-100 text-amber-700' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
          {snapshot.muted ? <MicOff size={16} /> : <Mic size={16} />}
          {snapshot.muted ? 'Unmute' : 'Mute'}
        </button>
        <button type="button" disabled={!connected} onClick={() => setKeypad(k => !k)} aria-pressed={keypad}
          className={`${btn} disabled:opacity-40 ${keypad ? 'bg-np-blue/10 text-np-blue' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}>
          <Grid3x3 size={16} /> Keypad
        </button>
        {speaker.canSpeaker && (
          <button type="button" disabled={!connected} onClick={speaker.next}
            className={`${btn} disabled:opacity-40 bg-gray-50 text-gray-600 hover:bg-gray-100`}>
            <Volume2 size={16} /> <span className="truncate max-w-full px-1">{speaker.label}</span>
          </button>
        )}
        <button type="button" onClick={hangUp} className={`${btn} bg-red-500 hover:bg-red-600 text-white`}>
          <PhoneOff size={16} /> Hang up
        </button>
      </div>
    </div>
  )
}

/**
 * Phone: the same full-screen layout as the incoming call overlay
 * (incoming-call-banner.tsx MobileCallOverlay), just below it in the stack so
 * an incoming call still shows on top. Minimize returns to the Hub page with
 * the call still live; the top indicator brings this back.
 */
function MobileOutboundOverlay({ onMinimize }: { onMinimize: () => void }) {
  const { snapshot, hangUp, setMuted, sendDigits } = useOutboundCall()
  const status = useCallStatusText()
  const speaker = useSpeaker()
  const [keypad, setKeypad] = useState(false)
  const [sent, setSent] = useState('')
  const connected = snapshot.stage === 'connected'
  const t = snapshot.target
  const number = t ? formatUsPhone(t.phone) : ''

  const bigBtn = 'flex flex-col items-center gap-2 text-white text-sm font-semibold select-none'
  const ctlBtn = 'flex flex-col items-center justify-center gap-1.5 h-20 rounded-2xl text-xs font-semibold select-none'

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Call with ${targetLabel(t)}`}
      data-testid="outbound-call-overlay"
      className="fixed inset-0 z-[1990] flex flex-col bg-np-dark text-white overscroll-none touch-manipulation"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 24px)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 24px)',
      }}
    >
      <div className="px-4">
        <button type="button" onClick={onMinimize}
          className="flex items-center gap-1.5 rounded-full bg-white/10 active:bg-white/25 px-3 py-2 text-sm font-semibold">
          <ChevronDown size={16} /> Back to Hub
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center min-h-0" aria-live="polite">
        <p className="text-xs font-semibold uppercase tracking-widest text-white/70">
          {connected ? `On call · ${status}` : status}
        </p>
        <span className="relative mt-6 flex h-20 w-20 items-center justify-center">
          {!connected && <span className="absolute inline-flex h-full w-full rounded-full bg-white/20 animate-ping" />}
          <span className={`relative inline-flex h-20 w-20 items-center justify-center rounded-full ${connected ? 'bg-green-500/30' : 'bg-white/20'}`}>
            {connected ? <PhoneCall size={32} className="text-green-300" /> : <PhoneOutgoing size={32} />}
          </span>
        </span>
        <p className="mt-5 text-3xl font-bold leading-tight break-words max-w-full">{targetLabel(t)}</p>
        {t?.name && number && <p className="mt-1 text-base font-mono text-white/70">{number}</p>}
        {connected && keypad && <p className="mt-4 min-h-[2rem] text-2xl font-mono tracking-widest">{sent}</p>}
      </div>

      <div className="px-6">
        <div className="flex flex-col items-center gap-5 pb-2">
          {connected && keypad && (
            <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
              {DIAL_KEYS.map(d => (
                <button key={d} type="button" onClick={() => { sendDigits(d); setSent(p => (p + d).slice(-20)) }}
                  className="h-14 rounded-2xl bg-white/10 active:bg-white/25 text-2xl font-light select-none">
                  {d}
                </button>
              ))}
            </div>
          )}
          {connected && (
            <div className={`grid w-full max-w-xs gap-3 ${speaker.canSpeaker ? 'grid-cols-3' : 'grid-cols-2'}`}>
              <button type="button" onClick={() => setMuted(!snapshot.muted)} aria-pressed={snapshot.muted}
                className={`${ctlBtn} ${snapshot.muted ? 'bg-amber-400 text-np-dark' : 'bg-white/10 active:bg-white/25'}`}>
                {snapshot.muted ? <MicOff size={24} /> : <Mic size={24} />}
                {snapshot.muted ? 'Unmute' : 'Mute'}
              </button>
              <button type="button" onClick={() => setKeypad(k => !k)} aria-pressed={keypad}
                className={`${ctlBtn} ${keypad ? 'bg-white/30' : 'bg-white/10 active:bg-white/25'}`}>
                <Grid3x3 size={24} />
                {keypad ? 'Hide keypad' : 'Keypad'}
              </button>
              {speaker.canSpeaker && (
                <button type="button" onClick={speaker.next} className={`${ctlBtn} bg-white/10 active:bg-white/25`}>
                  <Volume2 size={24} />
                  <span className="truncate max-w-full px-1">{speaker.label}</span>
                </button>
              )}
            </div>
          )}
          <button type="button" onClick={hangUp} className={bigBtn} aria-label="Hang up">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-red-600 active:bg-red-500 shadow-lg">
              <PhoneOff size={32} />
            </span>
            Hang up
          </button>
        </div>
      </div>
    </div>
  )
}

export default GlobalCallButton
