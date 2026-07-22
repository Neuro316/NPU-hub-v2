'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Duplicates — merge review queue (Phase 1: backlog sweep)
// Route: /crm/duplicates
// Detection: /api/contacts/duplicates · Merge: /api/contacts/merge
// ═══════════════════════════════════════════════════════════════

import { useCallback, useEffect, useState } from 'react'
import {
  Users, ShieldCheck, AlertTriangle, Check, X, Loader2, RefreshCw, GitMerge,
} from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { formatUsPhone } from '@/lib/phone'

type Confidence = 'high' | 'review'

interface Member {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  pipeline_stage: string | null
  source: string | null
  tags: string[] | null
  created_at: string
  last_contacted_at: string | null
  total_calls: number | null
  notes: string | null
  completeness: number
}

interface Group {
  key: string
  signals: string[]
  confidence: Confidence
  suggested_winner_id: string | null
  members: Member[]
}

// Fields shown side-by-side. `label` is what the reviewer reads; `pick` decides
// whether a value can be carried onto the survivor.
const FIELDS: { key: keyof Member; label: string; pick: boolean }[] = [
  { key: 'first_name', label: 'First name', pick: true },
  { key: 'last_name', label: 'Last name', pick: true },
  { key: 'email', label: 'Email', pick: true },
  { key: 'phone', label: 'Phone', pick: true },
  { key: 'pipeline_stage', label: 'Pipeline stage', pick: true },
  { key: 'source', label: 'Source', pick: false },
  { key: 'total_calls', label: 'Calls', pick: false },
  { key: 'last_contacted_at', label: 'Last contacted', pick: false },
  { key: 'created_at', label: 'Created', pick: false },
]

const fmt = (v: any) => {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v).toLocaleDateString()
  return String(v)
}

export default function DuplicatesPage() {
  const { currentOrg } = useWorkspace()
  const [groups, setGroups] = useState<Group[]>([])
  const [counts, setCounts] = useState<{ total: number; high: number; review: number; dismissed: number } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | Confidence>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [winnerId, setWinnerId] = useState<string | null>(null)
  const [picks, setPicks] = useState<Record<string, string>>({})   // field -> contact id
  const [busy, setBusy] = useState<'' | 'merging' | 'dismissing'>('')
  const [flash, setFlash] = useState('')

  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`/api/contacts/duplicates?org_id=${encodeURIComponent(currentOrg.id)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not load duplicates')
      setGroups(data.groups || [])
      setCounts(data.counts || null)
    } catch (e: any) {
      setError(e?.message || 'Could not load duplicates')
    } finally {
      setLoading(false)
    }
  }, [currentOrg])

  useEffect(() => { load() }, [load])

  const visible = groups.filter(g => filter === 'all' || g.confidence === filter)
  const selected = visible.find(g => g.key === selectedKey) || null

  // Selecting a group resets the survivor to the fullest record and clears picks.
  const openGroup = (g: Group) => {
    setSelectedKey(g.key)
    setWinnerId(g.suggested_winner_id)
    setPicks({})
    setError('')
  }

  const merge = async () => {
    if (!selected || !winnerId || !currentOrg) return
    const losers = selected.members.filter(m => m.id !== winnerId)
    if (!losers.length) return
    setBusy('merging'); setError('')
    try {
      // Field picks become winner_updates; the route applies, never decides.
      const winner_updates: Record<string, any> = {}
      for (const [field, fromId] of Object.entries(picks)) {
        if (fromId === winnerId) continue
        const src = selected.members.find(m => m.id === fromId)
        if (src) winner_updates[field] = (src as any)[field]
      }

      // Merge one loser at a time so a mid-way failure leaves a consistent state.
      for (const loser of losers) {
        const res = await fetch('/api/contacts/merge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            surviving_contact_id: winnerId,
            merging_contact_id: loser.id,
            winner_updates,
            reason: `duplicates queue — ${selected.signals.join('+')}`,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || 'Merge failed')
      }
      setFlash(`Merged ${losers.length} record${losers.length > 1 ? 's' : ''}`)
      setTimeout(() => setFlash(''), 3000)
      setSelectedKey(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Merge failed')
    } finally {
      setBusy('')
    }
  }

  const dismiss = async () => {
    if (!selected || !currentOrg) return
    setBusy('dismissing'); setError('')
    try {
      const res = await fetch('/api/contacts/duplicates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          contact_ids: selected.members.map(m => m.id),
          signal: selected.signals.join('+'),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not dismiss')
      setFlash('Marked as different people — won’t be flagged again')
      setTimeout(() => setFlash(''), 3000)
      setSelectedKey(null)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Could not dismiss')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex gap-4 h-full animate-in fade-in duration-300">
      {/* Queue */}
      <div className="w-72 flex-shrink-0 flex flex-col">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-np-dark">Duplicates</h2>
          <button onClick={load} className="p-1 text-gray-400 hover:text-np-blue" title="Rescan">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>

        <div className="flex bg-gray-50 rounded-lg p-0.5 mb-2">
          {([
            { key: 'all', label: `All ${counts ? counts.total : ''}` },
            { key: 'high', label: `High ${counts ? counts.high : ''}` },
            { key: 'review', label: `Review ${counts ? counts.review : ''}` },
          ] as const).map(f => (
            <button key={f.key} onClick={() => setFilter(f.key as any)}
              className={`flex-1 py-1.5 text-[9px] font-medium rounded-md transition-all ${
                filter === f.key ? 'bg-white text-np-dark shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>{f.label}</button>
          ))}
        </div>

        <div className="flex-1 overflow-auto space-y-1">
          {loading && <p className="text-[10px] text-gray-400 text-center py-6">Scanning…</p>}
          {!loading && !visible.length && (
            <p className="text-[10px] text-gray-400 text-center py-6">
              No duplicates found{counts?.dismissed ? ` (${counts.dismissed} pairs dismissed)` : ''}.
            </p>
          )}
          {visible.map(g => {
            const lead = g.members[0]
            return (
              <button key={g.key} onClick={() => openGroup(g)}
                className={`w-full text-left p-2.5 rounded-lg border transition-all ${
                  selectedKey === g.key ? 'border-np-blue/30 bg-np-blue/5' : 'border-gray-100 hover:bg-gray-50'
                }`}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  {g.confidence === 'high'
                    ? <ShieldCheck size={11} className="text-green-600" />
                    : <AlertTriangle size={11} className="text-amber-500" />}
                  <span className="text-xs font-semibold text-np-dark truncate">
                    {lead?.first_name} {lead?.last_name}
                  </span>
                  <span className="ml-auto text-[9px] text-gray-400">{g.members.length}</span>
                </div>
                <p className="text-[9px] text-gray-400">
                  matched on {g.signals.join(', ')}
                </p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Compare */}
      <div className="flex-1 min-w-0">
        {flash && (
          <div className="mb-2 flex items-center gap-1.5 text-[10px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <Check size={12} /> {flash}
          </div>
        )}
        {error && (
          <div className="mb-2 flex items-start gap-2 text-[10px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" /> {error}
          </div>
        )}

        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-center rounded-xl border border-gray-100 bg-white">
            <Users size={26} className="text-gray-200 mb-2" />
            <p className="text-xs text-gray-400">Select a group to compare</p>
            <p className="text-[10px] text-gray-300 mt-1 max-w-sm">
              High confidence = same email or phone. Review = matched on name or a fuzzy
              identity link, which can be two different people.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-bold text-np-dark">
                  {selected.members.length} possible duplicates
                </h3>
                <p className="text-[10px] text-gray-400">
                  Matched on {selected.signals.join(', ')} · keeping the record marked <b>Survivor</b>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={dismiss} disabled={!!busy}
                  className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-np-dark text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40">
                  <X size={12} /> {busy === 'dismissing' ? 'Saving…' : 'Different people'}
                </button>
                <button onClick={merge} disabled={!!busy || !winnerId}
                  className="flex items-center gap-1.5 px-4 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40">
                  {busy === 'merging' ? <Loader2 size={12} className="animate-spin" /> : <GitMerge size={12} />}
                  {busy === 'merging' ? 'Merging…' : 'Merge'}
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left text-[9px] font-semibold uppercase tracking-wider text-gray-400 pb-2 w-32">Field</th>
                    {selected.members.map(m => (
                      <th key={m.id} className="text-left pb-2 px-2 min-w-[180px]">
                        <button onClick={() => setWinnerId(m.id)}
                          className={`w-full text-left p-2 rounded-lg border transition-all ${
                            winnerId === m.id ? 'border-np-blue bg-np-blue/5' : 'border-gray-100 hover:bg-gray-50'
                          }`}>
                          <span className={`text-[9px] font-bold uppercase tracking-wider ${
                            winnerId === m.id ? 'text-np-blue' : 'text-gray-300'
                          }`}>
                            {winnerId === m.id ? 'Survivor' : 'Merge away'}
                          </span>
                          <p className="text-[10px] text-gray-500 font-normal">
                            {m.completeness}% complete
                          </p>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FIELDS.map(f => {
                    const values = selected.members.map(m => fmt(
                      f.key === 'phone' ? formatUsPhone(String(m.phone || '')) : (m as any)[f.key]
                    ))
                    const differs = new Set(values).size > 1
                    return (
                      <tr key={String(f.key)} className={differs ? 'bg-amber-50/40' : ''}>
                        <td className="py-1.5 text-[10px] font-medium text-gray-500">{f.label}</td>
                        {selected.members.map((m, i) => {
                          const isWinner = winnerId === m.id
                          const chosen = picks[String(f.key)] === m.id || (!picks[String(f.key)] && isWinner)
                          return (
                            <td key={m.id} className="py-1.5 px-2">
                              <button
                                disabled={!f.pick || !differs}
                                onClick={() => setPicks(p => ({ ...p, [String(f.key)]: m.id }))}
                                className={`w-full text-left px-2 py-1 rounded text-[11px] transition-all ${
                                  !f.pick || !differs ? 'text-gray-600 cursor-default'
                                    : chosen ? 'bg-np-blue/10 text-np-dark font-medium ring-1 ring-np-blue/30'
                                    : 'text-gray-500 hover:bg-gray-50'
                                }`}>
                                {values[i]}
                              </button>
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-[9px] text-gray-400 mt-3">
              Differing fields are highlighted — click a value to carry it onto the survivor.
              Merging keeps every call, message and record: the other records are hidden, not
              deleted, and each merge is snapshotted so it can be reversed.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
