// GET /api/drive/callback?code=&state=<org>.<nonce>
// Google OAuth return for Drive. Guarded (2026-11-08): the caller must be signed in as Hub staff of the org, and the
// state must match the one-time cookie /api/drive set for this same user and org when it built the auth URL. The
// refresh token is stored in Vault (src/lib/org-vault.ts) with the service role; nothing is written as the user.
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, DRIVE_STATE_COOKIE } from '@/lib/google-drive'
import { withStaff, requireOrg } from '@/lib/api-guard'
import { patchSetting, writeOrgCredential } from '@/lib/org-vault'

export const dynamic = 'force-dynamic'

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

function back(status: 'connected' | 'error', msg?: string) {
  const res = NextResponse.redirect(`${baseUrl()}/settings?drive=${status}${msg ? `&msg=${encodeURIComponent(msg)}` : ''}`)
  res.cookies.set(DRIVE_STATE_COOKIE, '', { path: '/api/drive/callback', maxAge: 0 })
  return res
}

export const GET = withStaff(async (req: NextRequest, ctx) => {
  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state') ?? ''
  if (!code) return NextResponse.json({ error: 'No code provided' }, { status: 400 })

  // state = <org>.<nonce>; cookie = <nonce>.<user>.<org>, all three must agree with the signed-in caller
  const [stateOrg, stateNonce] = state.split('.')
  const [cNonce, cUser, cOrg] = (req.cookies.get(DRIVE_STATE_COOKIE)?.value ?? '').split('.')
  if (!stateOrg || !stateNonce || stateNonce !== cNonce || cUser !== ctx.userId || cOrg !== stateOrg) {
    return back('error', 'state_mismatch')
  }
  const orgId = requireOrg(ctx, stateOrg)
  if (orgId instanceof Response) return back('error', 'not_your_org')

  try {
    const tokens = await exchangeCode(code)
    if (!tokens.refresh_token) return back('error', 'no_refresh_token')
    await writeOrgCredential(ctx.db, orgId, 'google_drive', 'refresh_token', tokens.refresh_token)
    await patchSetting(ctx.db, orgId, 'google_drive', { connected: true, connected_at: new Date().toISOString() })
    return back('connected')
  } catch (e: any) {
    console.error(`[drive/callback] org=${orgId} failed: ${String(e?.message ?? 'error').slice(0, 80)}`)
    return back('error', 'connect_failed')
  }
})
