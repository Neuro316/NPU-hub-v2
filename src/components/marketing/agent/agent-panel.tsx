'use client'
// One side panel, two modes (ruling 15): the Hub Guide and the Campaign Builder. The Builder tab
// appears only for a superadmin with the Builder switched on; the server checks both again on
// every call, so hiding the tab is a convenience, not the guard.
import { useState } from 'react'
import { X, Compass, Sparkles } from 'lucide-react'
import { GuideFlow } from './guide-flow'
import { BuilderFlow } from './builder-flow'

export type PanelMode = 'guide' | 'builder'

export function AgentPanel({ orgId, open, mode, onMode, onClose, guideOn, builderOn, campaignId, onBuilt }: {
  orgId: string; open: boolean; mode: PanelMode; onMode: (m: PanelMode) => void; onClose: () => void
  guideOn: boolean; builderOn: boolean; campaignId?: string | null; onBuilt: (ids: any) => void
}) {
  const [key, setKey] = useState(0)
  if (!open) return null
  const tab = (m: PanelMode, label: string, Icon: any) => (
    <button type="button" role="tab" aria-selected={mode === m} onClick={() => onMode(m)}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ${mode === m ? 'bg-white font-medium text-np-dark shadow-sm' : 'text-gray-500'}`}><Icon className="h-3.5 w-3.5" aria-hidden />{label}</button>)
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-100 bg-white shadow-xl" aria-label="Hub Guide and Campaign Builder">
      <div className="flex items-center gap-2 border-b border-gray-100 p-3">
        <div className="flex gap-1 rounded-lg bg-gray-50 p-1" role="tablist">
          {guideOn && tab('guide', 'Hub Guide', Compass)}
          {builderOn && tab('builder', 'Campaign Builder', Sparkles)}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => { setKey(key + 1) }} className="text-[11px] text-gray-500 underline">Start over</button>
        <button type="button" onClick={onClose} aria-label="Close the panel" className="rounded p-1 text-gray-400 hover:text-np-dark"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {mode === 'guide' && guideOn && <GuideFlow key={`g${key}`} orgId={orgId} onHandoff={builderOn ? () => onMode('builder') : undefined} />}
        {mode === 'builder' && builderOn && <BuilderFlow key={`b${key}-${campaignId ?? ''}`} orgId={orgId} campaignId={campaignId} compact onBuilt={onBuilt} />}
        {!guideOn && !builderOn && <p className="text-sm text-gray-500">Neither the Hub Guide nor the Campaign Builder is switched on for this organization.</p>}
      </div>
    </aside>)
}
