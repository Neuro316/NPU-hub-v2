// src/components/crm/data-api-badge.tsx
// ═══════════════════════════════════════════════════════════════
// "Data API Connected" Badge
//
// Displays on contact cards when neuroreport_linked = true.
// Shows green dot + text, with tooltip showing details.
// Dynamically appears on cards in the Enrolled pipeline.
// ═══════════════════════════════════════════════════════════════

'use client'

import { useState } from 'react'
import { Wifi, WifiOff, ExternalLink } from 'lucide-react'

interface DataApiBadgeProps {
  linked: boolean
  linkedAt?: string | null
  program?: string | null
  patientId?: string | null
  compact?: boolean  // For card view (just dot + short text)
}

export function DataApiBadge({ linked, linkedAt, program, patientId, compact = false }: DataApiBadgeProps) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (!linked) return null

  if (compact) {
    return (
      <div className="relative inline-flex items-center gap-1">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <span className="text-[9px] font-medium text-emerald-600 whitespace-nowrap">
          API Connected
        </span>
      </div>
    )
  }

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 cursor-default">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        <Wifi className="w-3 h-3 text-emerald-600" />
        <span className="text-[11px] font-semibold text-emerald-700">
          Data API Connected
        </span>
      </div>

      {/* Tooltip */}
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64">
          <div className="bg-gray-900 text-white rounded-lg shadow-lg p-3 text-xs">
            <div className="font-semibold mb-1.5 text-emerald-400 flex items-center gap-1">
              <Wifi className="w-3 h-3" />
              NeuroReport Integration Active
            </div>
            <div className="space-y-1 text-gray-300">
              {program && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Program:</span>
                  <span className="font-medium text-white">{program}</span>
                </div>
              )}
              {linkedAt && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Linked:</span>
                  <span>{new Date(linkedAt).toLocaleDateString()}</span>
                </div>
              )}
              {patientId && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Patient ID:</span>
                  <span className="font-mono text-[10px]">{patientId.slice(0, 12)}...</span>
                </div>
              )}
            </div>
            {/* Arrow */}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-2 h-2 bg-gray-900 rotate-45 -mt-1" />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Disconnected state badge (optional — for when API was connected but lost)
 */
export function DataApiDisconnectedBadge() {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200">
      <WifiOff className="w-3 h-3 text-amber-600" />
      <span className="text-[11px] font-medium text-amber-700">
        API Disconnected
      </span>
    </div>
  )
}

/**
 * Auto-tag indicator — shows next to tags that were applied by automation
 */
export function AutoTagIndicator({ tag, source }: { tag: string; source?: string }) {
  const [showTip, setShowTip] = useState(false)

  const sourceLabels: Record<string, string> = {
    stripe: 'Stripe purchase',
    neuroreport: 'NeuroReport sync',
    trigger: 'System automation',
  }

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 border border-blue-200 text-blue-700">
        {tag}
        <span className="text-[8px] text-blue-400">⚡</span>
      </span>
      {showTip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50">
          <div className="bg-gray-900 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
            Auto-applied{source ? ` via ${sourceLabels[source] || source}` : ''}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-1.5 h-1.5 bg-gray-900 rotate-45 -mt-0.5" />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Enrollment type badge — shows Mastermind / HC / Clinician/Coach
 */
export function EnrollmentTypeBadge({ type }: { type: string | null | undefined }) {
  if (!type) return null

  const config: Record<string, { label: string; bg: string; text: string; border: string }> = {
    mastermind: {
      label: 'Mastermind',
      bg: 'bg-purple-50',
      text: 'text-purple-700',
      border: 'border-purple-200',
    },
    hc: {
      label: 'HC',
      bg: 'bg-teal-50',
      text: 'text-teal-700',
      border: 'border-teal-200',
    },
    clinician_coach: {
      label: 'Clinician/Coach',
      bg: 'bg-indigo-50',
      text: 'text-indigo-700',
      border: 'border-indigo-200',
    },
  }

  const c = config[type] || {
    label: type,
    bg: 'bg-gray-50',
    text: 'text-gray-700',
    border: 'border-gray-200',
  }

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.text} border ${c.border}`}>
      {c.label}
    </span>
  )
}
