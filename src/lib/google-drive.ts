import { google } from 'googleapis'
import { Readable } from 'stream'

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set')

  const redirectUri = process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/drive/callback`
    : 'http://localhost:3000/api/drive/callback'

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri)
}

export function getAuthUrl(orgId?: string) {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive'],
    state: orgId || '',
  })
}

export async function exchangeCode(code: string) {
  const client = getOAuthClient()
  const { tokens } = await client.getToken(code)
  return tokens
}

function getDrive(refreshToken: string) {
  const client = getOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth: client })
}

export async function uploadFile(
  refreshToken: string, folderId: string, fileName: string, mimeType: string, buffer: Buffer
): Promise<{ id: string; name: string; webViewLink: string }> {
  const drive = getDrive(refreshToken)
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: Readable.from(buffer) },
    fields: 'id, name, webViewLink',
  })
  return { id: res.data.id!, name: res.data.name!, webViewLink: res.data.webViewLink! }
}

export async function listFiles(refreshToken: string, folderId: string) {
  const drive = getDrive(refreshToken)
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, webViewLink, createdTime)',
    orderBy: 'createdTime desc',
    pageSize: 50,
  })
  return (res.data.files || []).map(f => ({
    id: f.id!, name: f.name!, mimeType: f.mimeType || '',
    size: f.size || '0', webViewLink: f.webViewLink || '', createdTime: f.createdTime || '',
  }))
}

export async function createSubfolder(refreshToken: string, parentFolderId: string, folderName: string) {
  const drive = getDrive(refreshToken)
  const res = await drive.files.create({
    requestBody: { name: folderName, mimeType: 'application/vnd.google-apps.folder', parents: [parentFolderId] },
    fields: 'id, webViewLink',
  })
  return { id: res.data.id!, webViewLink: res.data.webViewLink! }
}

export async function deleteFile(refreshToken: string, fileId: string) {
  const drive = getDrive(refreshToken)
  await drive.files.delete({ fileId })
}

export function extractFolderId(url: string): string | null {
  const match = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return match ? match[1] : null
}

// Create a Google Doc from HTML content (converts automatically in Drive)
export async function createGoogleDoc(
  refreshToken: string,
  title: string,
  htmlContent: string,
  folderId?: string
): Promise<{ id: string; webViewLink: string }> {
  const client = getOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  const drive = google.drive({ version: 'v3', auth: client })

  const res = await drive.files.create({
    requestBody: {
      name: title,
      mimeType: 'application/vnd.google-apps.document',
      ...(folderId ? { parents: [folderId] } : {}),
    },
    media: {
      mimeType: 'text/html',
      body: Readable.from(Buffer.from(htmlContent, 'utf-8')),
    },
    fields: 'id, webViewLink',
  })

  return { id: res.data.id!, webViewLink: res.data.webViewLink! }
}
