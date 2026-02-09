'use client'

import { memo } from 'react'
import { Handle, Position } from 'reactflow'

interface ConvergenceNodeData {
  title: string
  description: string
  icon: string
  color: string
  onEdit: (id: string) => void
  cardId: string
}

function ConvergenceNode({ data }: { data: ConvergenceNodeData }) {
  return (
    <div
      className="group relative"
      onDoubleClick={() => data.onEdit(data.cardId)}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />

      <div
        className="bg-white rounded-2xl border-2 shadow-md hover:shadow-lg transition-all w-[220px] cursor-pointer"
        style={{ borderColor: data.color }}
      >
        <div className="p-4 text-center">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center mx-auto mb-2 text-lg"
            style={{ backgroundColor: `${data.color}15` }}
          >
            {data.icon}
          </div>
          <h3 className="text-sm font-bold text-np-dark mb-1">{data.title}</h3>
          {data.description && (
            <p className="text-[10px] text-gray-400 leading-relaxed">
              {data.description}
            </p>
          )}
          <div
            className="mt-2 text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full inline-block"
            style={{
              backgroundColor: `${data.color}15`,
              color: data.color,
            }}
          >
            Convergence Point
          </div>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        className="!w-3 !h-3 !bg-gray-300 !border-2 !border-white hover:!bg-np-blue !transition-colors"
      />
    </div>
  )
}

export default memo(ConvergenceNode)
