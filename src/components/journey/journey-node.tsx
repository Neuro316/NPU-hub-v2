'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { STATUS_CONFIG } from '@/lib/types/journey'

interface JourneyNodeData {
  title: string
  description: string
  status: 'not_started' | 'in_progress' | 'done'
  phaseColor: string
  cardId: string
  onStatusChange: (id: string) => void
  onEdit: (id: string) => void
}

function JourneyNode({ data, selected }: { data: JourneyNodeData; selected: boolean }) {
  const status = STATUS_CONFIG[data.status]

  return (
    <div onDoubleClick={() => data.onEdit(data.cardId)}>
      <Handle
        type="target"
        position={Position.Left}
        className="!w-2 !h-2 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-2 !h-2 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />

      <div
        className={`bg-white rounded-lg border-2 shadow-sm hover:shadow-md transition-all w-[180px] cursor-pointer ${selected ? 'ring-2 ring-np-blue ring-offset-2' : ''}`}
        style={{ borderColor: `${data.phaseColor}50` }}
      >
        <div className="h-1 rounded-t-[6px]" style={{ backgroundColor: data.phaseColor }} />
        <div className="p-2.5">
          <div className="flex items-center gap-1.5 mb-1">
            <button
              onClick={(e) => { e.stopPropagation(); data.onStatusChange(data.cardId) }}
              className="w-2.5 h-2.5 rounded-full border-[1.5px] transition-colors flex-shrink-0"
              style={{
                borderColor: status.color,
                backgroundColor: data.status === 'done' ? status.color : 'transparent',
              }}
              title={status.label}
            />
            <h3 className="text-xs font-semibold text-np-dark leading-tight truncate">{data.title}</h3>
          </div>
          {data.description && (
            <p className="text-[9px] text-gray-400 leading-snug line-clamp-2 ml-4">{data.description}</p>
          )}
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-2 !h-2 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-2 !h-2 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
    </div>
  )
}

export default memo(JourneyNode)
