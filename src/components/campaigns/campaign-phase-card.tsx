'use client'

import type { JourneyCard } from '@/lib/types/journey'
import { CARD_STATUS_CONFIG } from '@/lib/types/journey'
import type { ChecklistItem, Tester } from '@/lib/types/journey'
import { User, Link2, CheckCircle2 } from 'lucide-react'

interface Props {
  card: JourneyCard
  phaseColor: string
  onClick: () => void
}

export function CampaignPhaseCard({ card, phaseColor, onClick }: Props) {
  const status = CARD_STATUS_CONFIG[card.status] || CARD_STATUS_CONFIG.not_started
  const checklist: ChecklistItem[] = (card as any).checklist || []
  const testers: Tester[] = (card as any).testers || []
  const checkDone = checklist.filter(c => c.done).length
  const checkTotal = checklist.length
  const checkPct = checkTotal > 0 ? Math.round((checkDone / checkTotal) * 100) : 0
  const assignee = card.custom_fields?.assignee as string | undefined
  const taskCount = card.custom_fields?.linked_tasks?.length || 0

  return (
    <div onClick={onClick}
      className="bg-white rounded-lg p-2.5 cursor-pointer hover:shadow-md transition-all group"
      style={{ borderLeft: `3px solid ${status.color}` }}>
      {/* Title + status */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <p className="text-[11px] font-medium text-np-dark leading-snug flex-1">{card.title}</p>
        <span className="text-xs flex-shrink-0" title={status.label}>{status.emoji}</span>
      </div>

      {/* Description */}
      {card.description && (
        <p className="text-[10px] text-gray-500 line-clamp-2 mb-1.5">{card.description}</p>
      )}

      {/* Assignee */}
      {assignee && (
        <div className="flex items-center gap-1 text-[9px] text-gray-500 mb-1.5">
          <User className="w-2.5 h-2.5" /> {assignee}
        </div>
      )}

      {/* Checklist progress */}
      {checkTotal > 0 && (
        <div className="mb-1.5">
          <div className="flex items-center gap-1.5 mb-0.5">
            <CheckCircle2 className="w-2.5 h-2.5 text-gray-400" />
            <span className="text-[9px] text-gray-500">{checkDone}/{checkTotal} checks · {checkPct}%</span>
          </div>
          <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{
              width: `${checkPct}%`,
              backgroundColor: checkPct === 100 ? '#10b981' : checkPct > 50 ? '#3b82f6' : '#f59e0b',
            }} />
          </div>
        </div>
      )}

      {/* Task links + testers */}
      <div className="flex items-center gap-2">
        {taskCount > 0 && (
          <span className="text-[9px] text-gray-400 flex items-center gap-0.5"><Link2 className="w-2.5 h-2.5" /> {taskCount} tasks</span>
        )}
        {testers.length > 0 && (
          <div className="flex gap-0.5">
            {testers.map((t, i) => (
              <span key={i} className={`text-[8px] px-1.5 py-0.5 rounded ${t.signedOff ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {t.name.split(' ')[0]} {t.signedOff ? '✓' : '⏳'}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
