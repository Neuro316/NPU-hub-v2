'use client'

import { ChevronLeft, ChevronRight, Zap, Hand, RefreshCw } from 'lucide-react'
import { STATUS_CONFIG } from '@/lib/types/journey'
import type { JourneyCard } from '@/lib/types/journey'

interface FlowCardProps {
  card: JourneyCard
  pathColor: string
  canMoveLeft: boolean
  canMoveRight: boolean
  onMoveLeft: () => void
  onMoveRight: () => void
  onClick: () => void
}

const autoIcons: Record<string, any> = {
  automated: Zap,
  hybrid: RefreshCw,
  manual: Hand,
}

const autoColors: Record<string, string> = {
  automated: '#F59E0B',
  hybrid: '#06B6D4',
  manual: '#9CA3AF',
}

export function FlowCard({
  card, pathColor, canMoveLeft, canMoveRight,
  onMoveLeft, onMoveRight, onClick,
}: FlowCardProps) {
  const status = STATUS_CONFIG[card.status]
  const fields = card.custom_fields || {}
  const automation = fields.automation
  const sectionLabel = fields.section_label
  const assetCount = (fields.assets || []).length
  const taskCount = (fields.linked_tasks || []).length
  const AutoIcon = automation ? autoIcons[automation] : null

  return (
    <div className="group relative flex-shrink-0" style={{ width: 180 }}>
      <div
        onClick={onClick}
        className="bg-white rounded-lg border-2 cursor-pointer hover:shadow-md transition-all relative overflow-hidden"
        style={{ borderColor: pathColor + '40' }}
      >
        {/* Color bar */}
        <div className="h-1" style={{ backgroundColor: pathColor }} />

        <div className="p-2.5">
          {/* Title row */}
          <div className="flex items-start gap-1.5">
            <div
              className="w-2.5 h-2.5 rounded-full border-[1.5px] mt-0.5 flex-shrink-0"
              style={{
                borderColor: status.color,
                backgroundColor: card.status === 'done' ? status.color : 'transparent',
              }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold text-gray-800 leading-tight">{card.title}</p>
              {card.description && (
                <p className="text-[9px] text-gray-400 mt-0.5 line-clamp-2 leading-snug">{card.description}</p>
              )}
            </div>
          </div>

          {/* Bottom row: section label + automation + counts */}
          <div className="flex items-center justify-between mt-2 gap-1">
            <div className="flex items-center gap-1 min-w-0">
              {sectionLabel && (
                <span
                  className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded truncate max-w-[80px]"
                  style={{ backgroundColor: pathColor + '15', color: pathColor }}
                >
                  {sectionLabel}
                </span>
              )}
              <span
                className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: status.bg, color: status.color }}
              >
                {status.label}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              {assetCount > 0 && (
                <span className="text-[8px] text-gray-400">{assetCount}📎</span>
              )}
              {taskCount > 0 && (
                <span className="text-[8px] text-gray-400">{taskCount}✓</span>
              )}
              {AutoIcon && (
                <AutoIcon className="w-3 h-3" style={{ color: autoColors[automation] }} />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Move buttons */}
      <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 z-10">
        {canMoveLeft && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveLeft() }}
            className="bg-white border border-gray-200 rounded p-0.5 hover:bg-gray-50 shadow-sm"
          >
            <ChevronLeft className="w-3 h-3 text-gray-500" />
          </button>
        )}
        {canMoveRight && (
          <button
            onClick={(e) => { e.stopPropagation(); onMoveRight() }}
            className="bg-white border border-gray-200 rounded p-0.5 hover:bg-gray-50 shadow-sm"
          >
            <ChevronRight className="w-3 h-3 text-gray-500" />
          </button>
        )}
      </div>
    </div>
  )
}
