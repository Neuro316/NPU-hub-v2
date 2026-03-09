import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { uploadFile, listFiles, createSubfolder, deleteFile, extractFolderId, getAuthUrl } from '@/lib/google-drive'

export const maxDuration = 30

async function getRefreshToken(orgId: string): Promise<string | null> {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll() }, setAll() {} } }
  )
  const { data } = await supabase
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'google_drive')
    .single()

  return data?.setting_value?.refresh_token || null
}

export async function POST(req: NextRequest) {
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
      if (!orgId) return NextResponse.json({ success: false, error: 'No orgId provided' })

      const refreshToken = await getRefreshToken(orgId)
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

    // Auth URL - no token needed
    if (action === 'authUrl') {
      const url = getAuthUrl(orgId)
      return NextResponse.json({ success: true, url })
    }

    if (!orgId) return NextResponse.json({ success: false, error: 'orgId required' })

    // Check connection status
    if (action === 'status') {
      const token = await getRefreshToken(orgId)
      return NextResponse.json({ success: true, connected: !!token })
    }

    const refreshToken = await getRefreshToken(orgId)
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
    console.error('Drive API error:', error)
    return NextResponse.json({ success: false, error: error.message || 'Drive API error' }, { status: 500 })
  }
}
