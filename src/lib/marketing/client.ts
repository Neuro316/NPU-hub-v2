// src/lib/marketing/client.ts
// Browser-side calls to /api/marketing/*. Rejects any response that is not JSON: an
// expired session makes middleware redirect to /login, fetch follows it, and the login
// page arrives as a 200 that would otherwise read as success (CURRENT.md, 2026-09-03).
export class ApiError extends Error {
  constructor(message: string, public status: number, public body: any) { super(message) }
}

export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const type = res.headers.get('content-type') || ''
  if (res.redirected || !type.includes('application/json')) {
    throw new ApiError('Your session has ended. Sign in again to continue.', 401, null)
  }
  const json = await res.json()
  if (!res.ok) throw new ApiError(json?.error || 'Something went wrong. Try again.', res.status, json)
  return json as T
}
