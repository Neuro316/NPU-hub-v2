'use client'

import { Zap, Hand, RefreshCw, GripVertical } from 'lucide-react'
import { STATUS_CONFIG } from '@/lib/types/journey'
import type { JourneyCard } from '@/lib/types/journey'

interface FlowCardProps {
  card: JourneyCard
  pathColor: string
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

export function FlowCard({ card, pathColor, onClick }: FlowCardProps) {
  const status = STATUS_CONFIG[card.status]
  const fields = card.custom_fields || {}
  const automation = fields.automation
  const sectionLabel = fields.section_label
  const assetCount = (fields.assets || []).length
  const taskCount = (fields.linked_tasks || []).length
  const AutoIcon = automation ? autoIcons[automation] : null

  return (
    <div className="group/card relative flex-shrink-0" style={{ width: 180 }}>
      <div
        onClick={onClick}
        className="bg-white rounded-lg border-2 cursor-pointer hover:shadow-md transition-all relative overflow-hidden"
        style={{ borderColor: pathColor + '40' }}
      >
        <div className="h-1" style={{ backgroundColor: pathColor }} />

        <div className="p-2.5">
          <div className="flex items-start gap-1.5">
            {/* Drag handle - visible on hover */}
            <div className="flex-shrink-0 mt-0.5 opacity-0 group-hover/card:opacity-100 transition-opacity text-gray-300 hover:text-gray-500">
              <GripVertical className="w-3 h-3" />
            </div>

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

          <div className="flex items-center justify-between mt-2 gap-1">
            <div className="flex items-center gap-1 min-w-0">
              {sectionLabel && (
                <span className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded truncate max-w-[80px]"
                  style={{ backgroundColor: pathColor + '15', color: pathColor }}>{sectionLabel}</span>
              )}
              <span className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: status.bg, color: status.color }}>{status.label}</span>
            </div>
            <div className="flex items-center gap-1.5">
              {assetCount > 0 && <span className="text-[8px] text-gray-400">{assetCount} files</span>}
              {taskCount > 0 && <span className="text-[8px] text-gray-400">{taskCount} tasks</span>}
              {AutoIcon && <AutoIcon className="w-3 h-3" style={{ color: autoColors[automation] }} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
