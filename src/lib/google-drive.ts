import { google } from 'googleapis'
import { Readable } from 'stream'

function getAuth() {
  const credentials = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!credentials) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured')

  const parsed = JSON.parse(credentials)
  return new google.auth.GoogleAuth({
    credentials: parsed,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() })
}

/** Upload a file buffer to a specific Drive folder */
export async function uploadFile(
  folderId: string,
  fileName: string,
  mimeType: string,
  buffer: Buffer
): Promise<{ id: string; name: string; webViewLink: string }> {
  const drive = getDrive()

  const res = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: Readable.from(buffer),
    },
    fields: 'id, name, webViewLink',
  })

  return {
    id: res.data.id!,
    name: res.data.name!,
    webViewLink: res.data.webViewLink!,
  }
}

/** List files in a Drive folder */
export async function listFiles(folderId: string): Promise<Array<{
  id: string; name: string; mimeType: string; size: string; webViewLink: string; createdTime: string
}>> {
  const drive = getDrive()

  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, webViewLink, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 50,
  })

  return (res.data.files || []).map(f => ({
    id: f.id!,
    name: f.name!,
    mimeType: f.mimeType || '',
    size: f.size || '0',
    webViewLink: f.webViewLink || '',
    createdTime: f.createdTime || '',
  }))
}

/** Create a subfolder inside a parent folder */
export async function createSubfolder(
  parentFolderId: string,
  folderName: string
): Promise<{ id: string; webViewLink: string }> {
  const drive = getDrive()

  const res = await drive.files.create({
    requestBody: {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id, webViewLink',
  })

  return {
    id: res.data.id!,
    webViewLink: res.data.webViewLink!,
  }
}

/** Delete a file from Drive */
export async function deleteFile(fileId: string): Promise<void> {
  const drive = getDrive()
  await drive.files.delete({ fileId })
}

/** Extract folder ID from a Google Drive URL */
export function extractFolderId(url: string): string | null {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}
