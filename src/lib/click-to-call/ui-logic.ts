// src/lib/click-to-call/ui-logic.ts
// The button's state, keyed by the conversation it was fetched for. Switching
// conversations starts a new preflight, and a response that arrives for a thread
// that is no longer open is dropped, so the confirm can never show (or dial) the
// previous contact. Pure, so scripts/click-to-call/c2c-tamper.cjs can drive it.

export interface Preflight {
  conversation_id: string
  ok: boolean
  code: string | null
  message: string | null
  contact_name: string
  contact_phone: string | null
  staff_phone: string | null
  line: { e164: string; label: string; is_default: boolean } | null
  quiet_hours: { outside: boolean; timezone: string; localTime: string } | null
  live: boolean
  /** The org's eligible lines (line picker) and which one is today's default. */
  lines?: { id: string; e164: string; label: string }[]
  default_line_id?: string | null
}

export interface PreState {
  forId: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  data: Preflight | null
  error: string | null
}

export const IDLE: PreState = { forId: null, status: 'idle', data: null, error: null }

export function startPreflight(conversationId: string | null): PreState {
  return conversationId ? { forId: conversationId, status: 'loading', data: null, error: null } : IDLE
}

/** Accept a preflight result only if it is for the conversation open now. */
export function acceptPreflight(state: PreState, forId: string, result: { data?: Preflight; error?: string }): PreState {
  if (state.forId !== forId) return state
  if (result.data && result.data.conversation_id === forId) return { forId, status: 'ready', data: result.data, error: null }
  return { forId, status: 'error', data: null, error: result.error || 'Click-to-call could not be checked.' }
}

/** Why the icon is disabled, in a plain sentence, or null when a call can be placed. */
export function disabledReason(state: PreState): string | null {
  if (state.status === 'loading' || state.status === 'idle') return 'Checking whether this contact can be called.'
  if (state.status === 'error') return state.error
  if (!state.data || !state.data.ok) return state.data?.message || 'This contact cannot be called right now.'
  return null
}

/**
 * The POST body: the conversation open at the moment of the click, never a stored one.
 * A line_id is sent only when the picker holds one of the listed lines AND it differs
 * from the default, so a call where nothing was chosen is exactly today's request.
 */
export function callRequestBody(
  openConversationId: string, state: PreState, selectedLineId?: string | null,
): { conversation_id: string; line_id?: string } | null {
  if (state.forId !== openConversationId || !state.data?.ok || state.data.conversation_id !== openConversationId) return null
  const lines = state.data.lines ?? []
  if (selectedLineId && selectedLineId !== state.data.default_line_id && lines.some((l) => l.id === selectedLineId)) {
    return { conversation_id: openConversationId, line_id: selectedLineId }
  }
  return { conversation_id: openConversationId }
}

// ── Line picker: the last choice is remembered per user. Storage can be missing or
// throw (private windows, blocked site data), so every access is guarded and any
// failure falls back to the default line.
export const lineStorageKey = (userId: string | null | undefined) => `npu_hub_c2c_line:${userId || 'anon'}`

export function readStoredLine(storage: Pick<Storage, 'getItem'> | null | undefined, key: string): string | null {
  try { return storage?.getItem(key) || null } catch { return null }
}
export function writeStoredLine(storage: Pick<Storage, 'setItem'> | null | undefined, key: string, lineId: string): void {
  try { storage?.setItem(key, lineId) } catch { /* not remembered; the default still applies */ }
}

/** The picker's starting value: the remembered line if it is still listed, else the default. */
export function initialLine(data: Preflight | null, stored: string | null): string | null {
  const lines = data?.lines ?? []
  if (stored && lines.some((l) => l.id === stored)) return stored
  return data?.default_line_id ?? null
}

/** A select only when there is a real choice; one eligible line (or none listed) is plain text. */
export function lineControl(data: Preflight | null): 'select' | 'text' {
  return (data?.lines?.length ?? 0) > 1 ? 'select' : 'text'
}
