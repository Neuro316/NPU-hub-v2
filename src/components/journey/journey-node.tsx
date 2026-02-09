'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { STATUS_CONFIG } from '@/lib/types/journey'

interface JourneyNodeData {
  title: string
  description: string
  status: 'not_started' | 'in_progress' | 'done'
  phaseLabel: string
  phaseColor: string
  onStatusChange: (id: string) => void
  onEdit: (id: string) => void
  cardId: string
}

function JourneyNode({ data }: { data: JourneyNodeData }) {
  const status = STATUS_CONFIG[data.status]

  return (
    <div
      className="group relative"
      onDoubleClick={() => data.onEdit(data.cardId)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2.5 !h-2.5 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />

      <div
        className="bg-white rounded-xl border-2 shadow-sm hover:shadow-md transition-all w-[200px] cursor-pointer"
        style={{ borderColor: `${data.phaseColor}40` }}
      >
        {/* Phase color bar */}
        <div
          className="h-1.5 rounded-t-[10px]"
          style={{ backgroundColor: data.phaseColor }}
        />

        <div className="p-3">
          {/* Phase label */}
          <div className="flex items-center justify-between mb-1.5">
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: `${data.phaseColor}15`,
                color: data.phaseColor,
              }}
            >
              {data.phaseLabel}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                data.onStatusChange(data.cardId)
              }}
              className="w-3 h-3 rounded-full border-2 transition-colors flex-shrink-0"
              style={{
                borderColor: status.color,
                backgroundColor: data.status === 'done' ? status.color : 'transparent',
              }}
              title={status.label}
            />
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold text-np-dark leading-tight mb-1">
            {data.title}
          </h3>

          {/* Description */}
          {data.description && (
            <p className="text-[10px] text-gray-400 leading-relaxed line-clamp-2">
              {data.description}
            </p>
          )}

          {/* Status */}
          <div className="mt-2">
            <span
              className="text-[9px] font-medium px-1.5 py-0.5 rounded"
              style={{ backgroundColor: status.bg, color: status.color }}
            >
              {status.label}
            </span>
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2.5 !h-2.5 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
    </div>
  )
}

export default memo(JourneyNode)
