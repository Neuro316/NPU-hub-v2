'use client'

// Lead value on a pipeline card (hub_pipeline_deals.value). Empty means no value,
// which is different from $0.

import { useEffect, useRef, useState } from 'react'
import { DollarSign } from 'lucide-react'

/** $1,250 or $1,250.50. Used on cards and stage headers. */
export function formatUsdFull(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2,
  })
}

/** $950, $12.4k, $1.2M. Used in the summary cards. */
export function formatUsdCompact(n: number): string {
  const abs = Math.abs(n)
  const trim = (x: number) => x.toFixed(1).replace(/\.0$/, '')
  if (abs >= 1_000_000) return `$${trim(n / 1_000_000)}M`
  if (abs >= 1_000) return `$${trim(n / 1_000)}k`
  return `$${Math.round(n)}`
}

/** Parses "$1,250.50", "1250" or "" (null). Returns undefined when it is not a valid amount. */
export function parseUsd(raw: string): number | null | undefined {
  const s = raw.replace(/[$,\s]/g, '')
  if (s === '') return null
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return undefined
  const n = Number(s)
  return n <= 9_999_999_999.99 ? n : undefined
}

export function LeadValueEditor({ value, onSave, size = 'card', onEditingChange }: {
  value: number | null
  onSave: (v: number | null) => Promise<void> | void
  size?: 'card' | 'detail'
  onEditingChange?: (editing: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { onEditingChange?.(editing) }, [editing])
  useEffect(() => { if (editing) inputRef.current?.select() }, [editing])

  const start = () => { setDraft(value === null ? '' : String(value)); setInvalid(false); setEditing(true) }
  const cancel = () => { setEditing(false); setInvalid(false) }
  const commit = async () => {
    const parsed = parseUsd(draft)
    if (parsed === undefined) { setInvalid(true); return }
    setEditing(false)
    if (parsed !== value) await onSave(parsed)
  }

  const isCard = size === 'card'

  if (editing) {
    return (
      <span className="inline-flex items-center gap-0.5" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
        <span className={isCard ? 'text-[10px] text-gray-400' : 'text-xs text-gray-400'}>$</span>
        <input
          ref={inputRef}
          value={draft}
          inputMode="decimal"
          aria-label="Lead value in US dollars"
          placeholder="0"
          onChange={e => { setDraft(e.target.value); setInvalid(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          onBlur={commit}
          className={`${isCard ? 'w-20 text-[10px] px-1 py-0.5' : 'w-full text-xs px-2.5 py-1.5'} border rounded focus:outline-none focus:ring-1 ${invalid ? 'border-red-300 focus:ring-red-300' : 'border-gray-200 focus:ring-np-blue/30'}`}
        />
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={e => { e.stopPropagation(); start() }}
      title={value === null ? 'Add a lead value' : 'Edit lead value'}
      className={isCard
        ? `text-[10px] font-semibold flex items-center gap-0.5 rounded px-1 -mx-1 hover:bg-green-50 ${value === null ? 'text-gray-300 opacity-0 group-hover:opacity-100' : 'text-green-600'}`
        : `w-full text-left text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white hover:border-np-blue/30 ${value === null ? 'text-gray-400' : 'font-semibold text-green-600'}`}
    >
      {isCard && value === null && <DollarSign size={9} />}
      {value === null ? (isCard ? 'Add value' : 'No value. Click to add.') : formatUsdFull(value)}
    </button>
  )
}
