// Guarded (2026-11-08): Hub staff of the org named (withStaff + requireOrg). The refresh token is read from Vault
// with the service role (src/lib/org-vault.ts) and never returned. The OAuth state is bound to this user and org
// by a one-time httpOnly cookie that /api/drive/callback checks.
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { uploadFile, listFiles, createSubfolder, deleteFile, extractFolderId, getAuthUrl, DRIVE_STATE_COOKIE } from '@/lib/google-drive'
import { withStaff, requireOrg, type StaffContext } from '@/lib/api-guard'
import { readOrgSetting } from '@/lib/org-vault'

export const maxDuration = 30
export const dynamic = 'force-dynamic'

async function getRefreshToken(ctx: StaffContext, orgId: string): Promise<string | null> {
  const v = await readOrgSetting<any>(ctx.db, orgId, 'google_drive')
  return typeof v?.refresh_token === 'string' && v.refresh_token ? v.refresh_token : null
}

export const POST = withStaff(async (req: NextRequest, ctx) => {
  try {
    const contentType = req.headers.get('content-type') || ''

    // File upload (multipart form data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const folderId = formData.get('folderId') as string | null
      const folderUrl = formData.get('folderUrl') as string | null
      const orgId = formData.get('orgId') as string | null

      if (!file) return NextResponse.json({ success: false, error: 'No file provided' })
      const org = requireOrg(ctx, orgId)
      if (org instanceof Response) return org

      const refreshToken = await getRefreshToken(ctx, org)
      if (!refreshToken) return NextResponse.json({ success: false, error: 'Google Drive not connected. Go to Settings to connect.' })

      const targetFolderId = folderId || (folderUrl ? extractFolderId(folderUrl) : null)
      if (!targetFolderId) return NextResponse.json({ success: false, error: 'No folder ID or URL provided' })

      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await uploadFile(refreshToken, targetFolderId, file.name, file.type, buffer)
      return NextResponse.json({ success: true, file: result })
    }

    // JSON actions
    const body = await req.json()
    const { action, folderId, folderUrl, folderName, fileId, orgId } = body

    const org = requireOrg(ctx, orgId)
    if (org instanceof Response) return org

    // Auth URL: state = org.nonce, and the nonce, user and org are pinned in a one-time cookie
    if (action === 'authUrl') {
      const nonce = randomBytes(24).toString('hex')
      const res = NextResponse.json({ success: true, url: getAuthUrl(`${org}.${nonce}`) })
      res.cookies.set(DRIVE_STATE_COOKIE, `${nonce}.${ctx.userId}.${org}`, {
        httpOnly: true, secure: true, sameSite: 'lax', path: '/api/drive/callback', maxAge: 600,
      })
      return res
    }

    // Check connection status
    if (action === 'status') {
      const token = await getRefreshToken(ctx, org)
      return NextResponse.json({ success: true, connected: !!token })
    }

    const refreshToken = await getRefreshToken(ctx, org)
    if (!refreshToken) {
      return NextResponse.json({ success: false, error: 'Google Drive not connected. Go to Settings to connect.', needsAuth: true })
    }

    const targetFolderId = folderId || (folderUrl ? extractFolderId(folderUrl) : null)

    switch (action) {
      case 'list': {
        if (!targetFolderId) return NextResponse.json({ success: false, error: 'No folder specified' })
        const files = await listFiles(refreshToken, targetFolderId)
        return NextResponse.json({ success: true, files })
      }
      case 'createFolder': {
        if (!targetFolderId) return NextResponse.json({ success: false, error: 'No parent folder specified' })
        if (!folderName) return NextResponse.json({ success: false, error: 'No folder name specified' })
        const folder = await createSubfolder(refreshToken, targetFolderId, folderName)
        return NextResponse.json({ success: true, folder })
      }
      case 'delete': {
        if (!fileId) return NextResponse.json({ success: false, error: 'No file ID specified' })
        await deleteFile(refreshToken, fileId)
        return NextResponse.json({ success: true })
      }
      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` })
    }
  } catch (error: any) {
    console.error(`[drive] failed: ${String(error?.message ?? 'error').slice(0, 80)}`)
    return NextResponse.json({ success: false, error: error.message || 'Drive API error' }, { status: 500 })
  }
})
