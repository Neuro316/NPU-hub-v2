// src/lib/marketing/university.ts
// The University link rule (ruling 11, Cameron's Stage 0 ruling 6): a deliver link may
// redirect to the University's own domain and nowhere else.
import { UNIVERSITY_ORIGIN } from './engine'

const BACKSLASH = String.fromCharCode(92)

/** Pure: the only URL /a/<token> may redirect to, or null. */
export function universityTarget(path: unknown): string | null {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes(BACKSLASH)) return null
  const url = new URL(path, UNIVERSITY_ORIGIN)
  return url.origin === UNIVERSITY_ORIGIN ? url.toString() : null
}
