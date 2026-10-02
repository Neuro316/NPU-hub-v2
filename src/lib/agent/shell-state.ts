// src/lib/agent/shell-state.ts
// The Hub Guide and Campaign Builder panel lives in the shared app shell (ruling 26), so its state
// outlives the page. Pure: the reducer, what may be stored, and the four rulings on 2026-10-02 as
// functions the shell calls, so each can be tested without a browser.
//
//   1. the old HelpBot is hidden only for a person the Guide allows, and only while the Guide is
//      on; otherwise it stays exactly as before
//   2. the launcher takes HelpBot's bottom-right corner for those people
//   3. sessionStorage, keyed by user and org, holding the scrubbed question the server returned and
//      never the question as typed; cleared on sign-out
//   4. the Builder tab is on every screen for a superadmin with agent_enabled

export type ShellMode = 'guide' | 'builder'
export interface Caps { guide: boolean; builder: boolean }
export interface GuideStep { article: string; text: string; route: string | null; target: string | null }
export interface GuideAnswer { found: boolean; text: string; cited: string[]; steps: GuideStep[]; handoff: boolean }
export interface GuideView { sessionId: string | null; question: string | null; message: string; answer: GuideAnswer | null; handoffAllowed: boolean; step: number }

export interface ShellState {
  open: boolean
  mode: ShellMode
  campaignId: string | null
  guide: GuideView | null
  builtAt: number | null
  builtCampaignId: string | null
}

export const INITIAL: ShellState = { open: false, mode: 'guide', campaignId: null, guide: null, builtAt: null, builtCampaignId: null }

export type ShellAction =
  | { type: 'open'; mode: ShellMode; campaignId?: string | null }
  | { type: 'close' }
  | { type: 'mode'; mode: ShellMode }
  | { type: 'answered'; view: Omit<GuideView, 'step'> }
  | { type: 'step'; to: number }
  | { type: 'reset' }
  | { type: 'built'; campaignId: string | null; at: number }
  | { type: 'hydrate'; state: Partial<ShellState> }

export function reducer(s: ShellState, a: ShellAction): ShellState {
  switch (a.type) {
    case 'open': return { ...s, open: true, mode: a.mode, campaignId: a.mode === 'builder' ? a.campaignId ?? null : s.campaignId }
    case 'close': return { ...s, open: false }
    case 'mode': return { ...s, mode: a.mode }
    case 'answered': return { ...s, guide: { ...a.view, step: 0 } }
    case 'step': {
      if (!s.guide?.answer) return s
      const last = s.guide.answer.steps.length - 1
      return { ...s, guide: { ...s.guide, step: Math.max(0, Math.min(a.to, last)) } }
    }
    case 'reset': return { ...INITIAL, open: s.open, mode: s.mode }
    case 'built': return { ...s, builtAt: a.at, builtCampaignId: a.campaignId }
    case 'hydrate': return { ...s, ...a.state }
  }
}

/**
 * The action recorded when the Guide answers. The question kept is the one the SERVER returned,
 * already scrubbed of emails and phone numbers; the question as typed is not a parameter, so it
 * cannot reach the state or the storage built from it (ruling 3).
 */
export function answeredAction(res: { session_id?: string | null; question?: string | null; message?: string; answer?: GuideAnswer | null; handoff_allowed?: boolean }): ShellAction {
  return { type: 'answered', view: { sessionId: res.session_id ?? null, question: typeof res.question === 'string' ? res.question : null,
    message: String(res.message ?? ''), answer: res.answer ?? null, handoffAllowed: !!res.handoff_allowed } }
}

// ── storage (ruling 3) ──
export const STORAGE_PREFIX = 'hub-agent-shell:'
export const storageKey = (userId: string, orgId: string) => `${STORAGE_PREFIX}${userId}:${orgId}`

export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; key(i: number): string | null; readonly length: number }

/** What is written: the panel's place and the Guide's view, nothing the person typed. */
export function persistable(s: ShellState): Partial<ShellState> {
  return { open: s.open, mode: s.mode, campaignId: s.campaignId, guide: s.guide }
}
export function saveShell(store: StorageLike, userId: string, orgId: string, s: ShellState) {
  try { store.setItem(storageKey(userId, orgId), JSON.stringify(persistable(s))) } catch { /* storage full or blocked: the panel still works */ }
}
export function loadShell(store: StorageLike, userId: string, orgId: string): Partial<ShellState> | null {
  try { const raw = store.getItem(storageKey(userId, orgId)); return raw ? (JSON.parse(raw) as Partial<ShellState>) : null } catch { return null }
}
/**
 * A switch of user or org: the state stored for the scope being LEFT is removed (the plan: cleared on
 * org switch), and the state stored for the new scope, if any, is returned to restore. A first
 * load (no previous scope, as after a reload) removes nothing, so a reload keeps the walkthrough.
 */
export function switchScope(store: StorageLike, prev: { userId: string; orgId: string } | null, next: { userId: string; orgId: string } | null): Partial<ShellState> | null {
  // switching org from most pages reloads the whole page (workspace switchOrg sets location), so the
  // scope last served is also kept in storage: the in-memory one alone would be lost on that reload
  let last = prev
  if (!last) {
    try { const raw = store.getItem(LAST_SCOPE); if (raw) { const [u, o] = raw.split(':'); if (u && o) last = { userId: u, orgId: o } } } catch { /* storage blocked */ }
  }
  if (last && (!next || last.userId !== next.userId || last.orgId !== next.orgId)) {
    try { store.removeItem(storageKey(last.userId, last.orgId)) } catch { /* storage blocked */ }
  }
  try { if (next) store.setItem(LAST_SCOPE, `${next.userId}:${next.orgId}`); else store.removeItem(LAST_SCOPE) } catch { /* storage blocked */ }
  return next ? loadShell(store, next.userId, next.orgId) : null
}
/** Which user and org this tab's panel last served (prefixed, so sign-out clears it too). */
export const LAST_SCOPE = `${STORAGE_PREFIX}last`

/** Sign-out: every stored panel state for every user and org on this tab is removed. */
export function clearShellStorage(store: StorageLike): number {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) { const k = store.key(i); if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k) }
  for (const k of keys) store.removeItem(k)
  return keys.length
}

// ── rulings 1, 2 and 4 ──
/** Ruling 1: the old HelpBot shows unless this person may use the Guide (which needs the Guide on). */
export const showHelpBot = (caps: Caps | null) => !caps?.guide
/** Ruling 2: the launcher takes HelpBot's corner when it replaces it; otherwise it sits above it. */
export const launcherPlacement = (caps: Caps | null): 'corner' | 'stacked' | 'none' =>
  !caps || (!caps.guide && !caps.builder) ? 'none' : caps.guide ? 'corner' : 'stacked'
/** Ruling 4: the panel's tabs on every screen, from the server's answer and nothing else. */
export const panelModes = (caps: Caps | null): ShellMode[] => [...(caps?.guide ? ['guide' as const] : []), ...(caps?.builder ? ['builder' as const] : [])]
