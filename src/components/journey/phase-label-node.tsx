'use client'

import { memo } from 'react'

interface PhaseLabelData {
  label: string
  color: string
  cardCount: number
}

function PhaseLabelNode({ data }: { data: PhaseLabelData }) {
  return (
    <div
      className="px-4 py-2 rounded-xl border-2 font-bold text-sm tracking-wide"
      style={{
        borderColor: data.color,
        backgroundColor: `${data.color}10`,
        color: data.color,
        writingMode: 'vertical-rl',
        textOrientation: 'mixed',
        minHeight: '120px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {data.label}
      <span
        className="ml-1 text-[10px] font-normal opacity-60"
        style={{ writingMode: 'vertical-rl' }}
      >
        ({data.cardCount})
      </span>
    </div>
  )
}

export default memo(PhaseLabelNode)
