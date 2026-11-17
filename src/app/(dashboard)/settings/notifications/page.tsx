'use client'

// Hub › Settings › Notifications (Running List q22). Org admins only; reads and saves through
// /api/settings/notifications. Every save shows an error when it fails.
import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'

type Urgency = 'urgent' | 'brief' | 'off'
interface Rule { recipient: string | null; urgency: Urgency }
interface Data { mode: 'off' | 'preview' | 'live'; rules: Record<string, Rule>; types: Array<{ key: string; label: string; note: string }>; staff: Array<{ user_id: string; name: string }> }

const URGENCY: Array<{ v: Urgency; label: string }> = [
  { v: 'urgent', label: 'Urgent: text now' }, { v: 'brief', label: '8 AM brief' }, { v: 'off', label: 'Off' },
]

export default function NotificationSettingsPage() {
  const { currentOrg } = useWorkspace()
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!currentOrg) return
    setData(null); setError(null)
    fetch(`/api/settings/notifications?org_id=${encodeURIComponent(currentOrg.id)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || 'Notifications could not be loaded.'); setData(d) })
      .catch(e => setError(String(e?.message || e)))
  }, [currentOrg])

  const setRule = (key: string, patch: Partial<Rule>) => setData(d => d && ({ ...d, rules: { ...d.rules, [key]: { ...d.rules[key], ...patch } } }))

  const save = async () => {
    if (!currentOrg || !data) return
    setSaving(true); setError(null)
    try {
      const r = await fetch('/api/settings/notifications', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org_id: currentOrg.id, mode: data.mode, rules: data.rules }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Notifications could not be saved.')
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: any) {
      setError(String(e?.message || e)); alert('Notifications were not saved: ' + (e?.message || 'unknown error'))
    } finally { setSaving(false) }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold text-np-dark flex items-center gap-2"><Bell className="w-5 h-5" /> Notifications</h1>
      <p className="text-xs text-gray-500">Urgent items text the recipient right away. Everything set to the brief rolls into one text at 8:05 AM Eastern on weekdays, also shown on the Brief page. The speed-to-lead alerts, the Monday scorecard and the watchdog keep working as they do today.</p>
      {error && <p className="text-sm text-red-500">{error}</p>}
      {!data && !error && <p className="text-sm text-gray-400">Loading...</p>}
      {data && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">8 AM brief:</span>
            <select value={data.mode} onChange={e => setData({ ...data, mode: e.target.value as Data['mode'] })} className="border rounded px-2 py-1 text-sm">
              <option value="off">Off</option>
              <option value="preview">Preview (shown on the Brief page, nothing sent)</option>
              {data.mode === 'live' && <option value="live">Live</option>}
            </select>
            {data.mode !== 'live' && <span className="text-[11px] text-gray-400">Live is switched on separately after a preview.</span>}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[10px] uppercase tracking-wider text-gray-400"><th className="py-1">Notification</th><th>Recipient</th><th>When</th></tr></thead>
            <tbody>
              {data.types.map(t => (
                <tr key={t.key} className="border-t border-gray-50">
                  <td className="py-2 pr-2"><p className="text-np-dark">{t.label}</p><p className="text-[10px] text-gray-400">{t.note}</p></td>
                  <td className="pr-2">
                    <select value={data.rules[t.key]?.recipient ?? ''} onChange={e => setRule(t.key, { recipient: e.target.value || null })} className="border rounded px-2 py-1 text-sm w-full">
                      <option value="">Nobody</option>
                      {data.staff.map(s => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={data.rules[t.key]?.urgency ?? 'brief'} onChange={e => setRule(t.key, { urgency: e.target.value as Urgency })} className="border rounded px-2 py-1 text-sm w-full">
                      {URGENCY.map(u => <option key={u.v} value={u.v}>{u.label}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button onClick={save} disabled={saving} className="text-sm bg-np-blue text-white px-4 py-1.5 rounded-lg disabled:opacity-50">{saving ? 'Saving...' : saved ? 'Saved' : 'Save'}</button>
        </>
      )}
    </div>
  )
}
