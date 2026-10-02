'use client'
// The Hub Guide and Campaign Builder in the app shell (ruling 26, decisions of 2026-10-02).
// Mounted once in the dashboard layout, so the panel and its state survive moving between pages.
//   - what this person may use comes from GET /api/marketing/agent (the same checks as the POSTs)
//   - state is kept in sessionStorage per user and org, holding the scrubbed question only, and is
//     cleared on org switch (reset), on sign-out, and by Start over
//   - the launcher takes the old HelpBot's corner for people the Guide allows, and HelpBot hides
//     for exactly those people (HelpBotGate); for everyone else HelpBot is unchanged
// Renders nothing until the server has answered, and nothing at all for a person with neither tab.
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Compass } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import { HelpBot } from '@/components/help-bot'
import { AgentPanel } from './agent-panel'
import { INITIAL, reducer, clearShellStorage, launcherPlacement, loadShell, panelModes, saveShell, showHelpBot,
  type Caps, type ShellAction, type ShellMode, type ShellState } from '@/lib/agent/shell-state'

interface ShellApi { caps: Caps | null; state: ShellState; open: (mode: ShellMode, campaignId?: string | null) => void; dispatch: (a: ShellAction) => void }
const ShellContext = createContext<ShellApi>({ caps: null, state: INITIAL, open: () => {}, dispatch: () => {} })
export const useAgentShell = () => useContext(ShellContext)

const store = () => (typeof window === 'undefined' ? null : window.sessionStorage)

export function AgentShellProvider({ children }: { children: React.ReactNode }) {
  const { user, currentOrg } = useWorkspace()
  const router = useRouter()
  const [state, dispatch] = useReducer(reducer, INITIAL)
  const [caps, setCaps] = useState<Caps | null>(null)
  const scope = useRef<string | null>(null)
  const userId = user?.id ?? null
  const orgId = currentOrg?.id ?? null

  // what this person may use, per org; anything that fails reads as nothing
  useEffect(() => {
    setCaps(null)
    if (!userId || !orgId) return
    let live = true
    fetch(`/api/marketing/agent?org_id=${encodeURIComponent(orgId)}`, { cache: 'no-store' })
      .then((r) => (r.ok && (r.headers.get('content-type') || '').includes('application/json') ? r.json() : null))
      .then((c) => { if (live) setCaps(c ? { guide: !!c.guide, builder: !!c.builder } : { guide: false, builder: false }) })
      .catch(() => { if (live) setCaps({ guide: false, builder: false }) })
    return () => { live = false }
  }, [userId, orgId])

  // a new user or org starts clean, then takes back what this tab stored for that user and org
  useEffect(() => {
    const key = userId && orgId ? `${userId}:${orgId}` : null
    if (key === scope.current) return
    scope.current = key
    dispatch({ type: 'reset' })
    dispatch({ type: 'close' })
    const s = store()
    if (s && userId && orgId) { const saved = loadShell(s, userId, orgId); if (saved) dispatch({ type: 'hydrate', state: saved }) }
  }, [userId, orgId])

  useEffect(() => { const s = store(); if (s && userId && orgId && scope.current === `${userId}:${orgId}`) saveShell(s, userId, orgId, state) }, [state, userId, orgId])

  // sign-out, including an expired session: every stored panel state on this tab goes
  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') { const s = store(); if (s) clearShellStorage(s); dispatch({ type: 'reset' }); dispatch({ type: 'close' }) }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const open = useCallback((mode: ShellMode, campaignId?: string | null) => dispatch({ type: 'open', mode, campaignId }), [])
  const onBuilt = useCallback((ids: any) => {
    dispatch({ type: 'built', campaignId: ids?.campaign ?? null, at: Date.now() })
    if (ids?.campaign) router.push(`/campaigns?tab=funnels&funnel=${ids.campaign}`)
  }, [router])
  const modes = panelModes(caps)
  const place = launcherPlacement(caps)
  const api = useMemo(() => ({ caps, state, open, dispatch }), [caps, state, open])

  return (
    <ShellContext.Provider value={api}>
      {children}
      {showHelpBot(caps) && <HelpBot />}
      {orgId && place !== 'none' && !state.open && (
        <button type="button" data-help-id="guide.launcher" onClick={() => open(modes[0])} aria-label={caps?.guide ? 'Open the Hub Guide' : 'Open the Campaign Builder'}
          className={`fixed right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-np-blue text-white shadow-lg transition-all hover:scale-105 ${place === 'corner' ? 'bottom-6' : 'bottom-24'}`}>
          <Compass className="h-6 w-6" aria-hidden /></button>)}
      {orgId && <AgentPanel orgId={orgId} state={state} dispatch={dispatch} modes={modes} onBuilt={onBuilt} />}
    </ShellContext.Provider>)
}
