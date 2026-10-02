// src/lib/marketing/validate/route.ts
// The one check for a routing rule's source key. POST /api/marketing/routes and the
// Campaign Builder agent both call this (agent ruling 3).

export const SOURCE_KEY = /^[a-z0-9][a-z0-9_.:-]{0,79}$/

export type SourceKeyCheck = { ok: true; key: string } | { ok: false; message: string }

export function checkSourceKey(raw: unknown): SourceKeyCheck {
  const key = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  if (!SOURCE_KEY.test(key)) return { ok: false, message: 'A source key uses lower case letters, numbers, and the characters . _ : -' }
  return { ok: true, key }
}
