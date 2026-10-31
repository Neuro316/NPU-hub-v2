'use client'

// The Media Library's side of Quick Send: which items are in it, and the
// "Available in Quick Send" switch with its category picker in an item's panel.
// It edits the same hub_quick_send_items row as CRM Settings, Quick Send
// Resources, so an item is never listed twice.

import { useCallback, useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import type { QuickSendCategory, QuickSendResource } from '@/lib/quick-send'
import { AvailableSwitch } from '@/components/settings/quick-send-resources'

export interface QuickSendIndex {
  categories: QuickSendCategory[]
  /** media_asset_id -> its Quick Send row (non-archived only) */
  items: Map<string, QuickSendResource>
  refresh: () => void
}

export function useQuickSendIndex(orgId: string | undefined): QuickSendIndex {
  const [categories, setCategories] = useState<QuickSendCategory[]>([])
  const [items, setItems] = useState<Map<string, QuickSendResource>>(new Map())
  const refresh = useCallback(() => {
    if (!orgId) return
    fetch(`/api/quick-send/resources?org_id=${encodeURIComponent(orgId)}&scope=manage`)
      .then(r => r.ok ? r.json() : null)
      .then(j => {
        if (!j) return
        setCategories(j.categories || [])
        setItems(new Map((j.resources || []).map((r: QuickSendResource) => [r.media_asset_id, r])))
      })
      .catch(() => { /* the library works without Quick Send */ })
  }, [orgId])
  useEffect(() => { refresh() }, [refresh])
  return { categories, items, refresh }
}

export function QuickSendBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-fire px-1.5 py-0.5 text-[7px] font-bold uppercase tracking-wider text-np-dark">
      <FileText className="h-2.5 w-2.5" /> Quick Send
    </span>
  )
}

export function MediaQuickSendSection({ orgId, assetId, hasFile, index }: {
  orgId: string
  assetId: string
  /** Uploaded to storage. A link-only item has nothing to attach. */
  hasFile: boolean
  index: QuickSendIndex
}) {
  const item = index.items.get(assetId)
  const [category, setCategory] = useState(item?.category_id || index.categories[0]?.id || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setCategory(item?.category_id || index.categories[0]?.id || '') }, [item?.category_id, index.categories])

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true); setError('')
    try {
      const res = await fetch('/api/quick-send/items', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId, media_asset_id: assetId, ...patch }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) setError(j?.error || 'Could not save.')
    } catch { setError('Could not save. Check the connection.') }
    setBusy(false)
    index.refresh()
  }

  const on = !!item?.available
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-np-dark">Available in Quick Send</p>
          <p className="text-[10px] text-gray-400">
            {hasFile ? 'Staff can email this file to a contact from a call or the contact view.' : 'Only uploaded files can be sent. This item is a link.'}
          </p>
        </div>
        <AvailableSwitch on={on} disabled={busy || !hasFile || !category} label="Available in Quick Send"
          onChange={v => save({ available: v, category_id: category })} />
      </div>
      {hasFile && (
        <label className="mt-2 block">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Quick Send category</span>
          <select value={category} disabled={busy}
            onChange={e => { setCategory(e.target.value); if (item) save({ category_id: e.target.value }) }}
            className="mt-1 h-11 w-full rounded-lg border border-gray-200 px-3 text-xs focus:outline-none focus:ring-1 focus:ring-np-blue/30">
            {index.categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="mt-2 text-[11px] text-red-600">{error}</p>}
    </div>
  )
}
