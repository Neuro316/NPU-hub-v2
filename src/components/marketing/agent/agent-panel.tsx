'use client'
// One side panel, two modes (ruling 15), mounted once in the app shell (ruling 26). The tabs come
// from what the server says this person may use; the server checks both again on every call, so
// hiding a tab is a convenience, not the guard.
import { X, Compass, Sparkles } from 'lucide-react'
import { GuideFlow } from './guide-flow'
import { BuilderFlow } from './builder-flow'
import type { ShellAction, ShellMode, ShellState } from '@/lib/agent/shell-state'

export type PanelMode = ShellMode

export function AgentPanel({ orgId, state, dispatch, modes, onBuilt }: {
  orgId: string; state: ShellState; dispatch: (a: ShellAction) => void; modes: ShellMode[]; onBuilt: (ids: any) => void
}) {
  if (!state.open || !modes.length) return null
  const mode = modes.includes(state.mode) ? state.mode : modes[0]
  const tab = (m: ShellMode, label: string, Icon: any) => (
    <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => dispatch({ type: 'mode', mode: m })}
      className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ${mode === m ? 'bg-white font-medium text-np-dark shadow-sm' : 'text-gray-500'}`}><Icon className="h-3.5 w-3.5" aria-hidden />{label}</button>)
  return (
    <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-gray-100 bg-white shadow-xl" aria-label="Hub Guide and Campaign Builder" data-help-id="guide.panel">
      <div className="flex items-center gap-2 border-b border-gray-100 p-3">
        <div className="flex gap-1 rounded-lg bg-gray-50 p-1" role="tablist">
          {modes.includes('guide') && tab('guide', 'Hub Guide', Compass)}
          {modes.includes('builder') && tab('builder', 'Campaign Builder', Sparkles)}
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => dispatch({ type: 'reset' })} className="text-[11px] text-gray-500 underline">Start over</button>
        <button type="button" onClick={() => dispatch({ type: 'close' })} aria-label="Close the panel" className="rounded p-1 text-gray-400 hover:text-np-dark"><X className="h-4 w-4" aria-hidden /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {mode === 'guide' && <GuideFlow orgId={orgId} view={state.guide} dispatch={dispatch} onHandoff={modes.includes('builder') ? () => dispatch({ type: 'mode', mode: 'builder' }) : undefined} />}
        {mode === 'builder' && <BuilderFlow key={`b-${state.campaignId ?? ''}-${state.guide ? 'g' : ''}`} orgId={orgId} campaignId={state.campaignId} compact onBuilt={onBuilt} />}
      </div>
    </aside>)
}
