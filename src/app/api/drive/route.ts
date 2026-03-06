import { NextRequest, NextResponse } from 'next/server'
import { uploadFile, listFiles, createSubfolder, deleteFile, extractFolderId } from '@/lib/google-drive'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''

    // File upload (multipart form data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const folderId = formData.get('folderId') as string | null
      const folderUrl = formData.get('folderUrl') as string | null

      if (!file) return NextResponse.json({ success: false, error: 'No file provided' })

      const targetFolderId = folderId || (folderUrl ? extractFolderId(folderUrl) : null)
      if (!targetFolderId) return NextResponse.json({ success: false, error: 'No folder ID or URL provided' })

      const buffer = Buffer.from(await file.arrayBuffer())
      const result = await uploadFile(targetFolderId, file.name, file.type, buffer)

      return NextResponse.json({ success: true, file: result })
    }

    // JSON actions (list, createFolder, delete)
    const body = await req.json()
    const { action, folderId, folderUrl, folderName, fileId } = body

    const targetFolderId = folderId || (folderUrl ? extractFolderId(folderUrl) : null)

    switch (action) {
      case 'list': {
        if (!targetFolderId) return NextResponse.json({ success: false, error: 'No folder specified' })
        const files = await listFiles(targetFolderId)
        return NextResponse.json({ success: true, files })
      }

      case 'createFolder': {
        if (!targetFolderId) return NextResponse.json({ success: false, error: 'No parent folder specified' })
        if (!folderName) return NextResponse.json({ success: false, error: 'No folder name specified' })
        const folder = await createSubfolder(targetFolderId, folderName)
        return NextResponse.json({ success: true, folder })
      }

      case 'delete': {
        if (!fileId) return NextResponse.json({ success: false, error: 'No file ID specified' })
        await deleteFile(fileId)
        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` })
    }
  } catch (error: any) {
    console.error('Drive API error:', error)
    return NextResponse.json(
      { success: false, error: error.message || 'Drive API error' },
      { status: 500 }
    )
  }
}
