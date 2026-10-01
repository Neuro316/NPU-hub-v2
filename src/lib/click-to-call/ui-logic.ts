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

/** The POST body: the conversation open at the moment of the click, never a stored one. */
export function callRequestBody(openConversationId: string, state: PreState): { conversation_id: string } | null {
  if (state.forId !== openConversationId || !state.data?.ok || state.data.conversation_id !== openConversationId) return null
  return { conversation_id: openConversationId }
}
