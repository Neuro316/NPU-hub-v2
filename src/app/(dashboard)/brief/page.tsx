'use client'

// Hub › Brief (Running List q22): the caller's 8 AM brief, built now from counts. Reads GET /api/brief only.
import { useEffect, useState } from 'react'
import { Sun } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'

interface Brief { mode: 'off' | 'preview' | 'live'; recipient?: boolean; since?: string; text?: string; lines?: string[]; empty?: boolean; error?: string }

const linkify = (line: string) => {
  const m = line.match(/^(.*?):\s(https?:\/\/\S+)$/)
  if (!m) return <span>{line}</span>
  const path = m[2].replace(/^https?:\/\/[^/]+/, '') || '/'
  return <span>{m[1]} <a href={path} className="text-np-blue hover:underline">Open</a></span>
}

export default function BriefPage() {
  const { currentOrg } = useWorkspace()
  const [brief, setBrief] = useState<Brief | null>(null)

  useEffect(() => {
    if (!currentOrg) return
    setBrief(null)
    fetch(`/api/brief?org_id=${encodeURIComponent(currentOrg.id)}`, { cache: 'no-store' })
      .then(async r => { const d = await r.json().catch(() => ({})); setBrief(r.ok ? d : { mode: 'off', error: d.error || 'The brief could not be loaded.' }) })
      .catch(() => setBrief({ mode: 'off', error: 'The brief could not be loaded.' }))
  }, [currentOrg])

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-lg font-semibold text-np-dark flex items-center gap-2"><Sun className="w-5 h-5 text-amber-500" /> Your morning brief</h1>
      {!brief && <p className="text-sm text-gray-400">Loading...</p>}
      {brief?.error && <p className="text-sm text-red-500">{brief.error}</p>}
      {brief && !brief.error && brief.mode === 'off' && (
        <p className="text-sm text-gray-500">The brief is off for this organization. An org admin can turn on Preview in Settings, Notifications.</p>
      )}
      {brief && !brief.error && brief.mode !== 'off' && (
        <>
          <div className={`text-xs rounded-lg px-3 py-2 ${brief.mode === 'live' ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
            {brief.mode === 'live' ? 'Live: this is texted to you at 8:05 AM Eastern on weekdays.' : 'Preview: this is what the 8 AM text would say. Nothing is sent.'}
            {!brief.recipient && ' You are not a recipient in the notification rules, so this shows only what is routed to you.'}
          </div>
          <div className="rounded-xl border border-gray-100 p-4 space-y-2">
            <p className="text-sm text-np-dark">Good morning. Your Hub brief:</p>
            {brief.empty ? <p className="text-sm text-gray-500">Nothing needs you this morning.</p> : (
              <ul className="space-y-1.5">{(brief.lines ?? []).map((l, i) => <li key={i} className="text-sm text-np-dark">{linkify(l)}</li>)}</ul>
            )}
            {brief.since && <p className="text-[10px] text-gray-400">New items counted since {new Date(brief.since).toLocaleString()}</p>}
          </div>
        </>
      )}
    </div>
  )
}
