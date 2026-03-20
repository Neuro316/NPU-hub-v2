// src/lib/storage.ts
// Centralised Supabase Storage helper — used across the entire Hub
// All uploads go through here so bucket names and paths are consistent.

import { createClient } from '@/lib/supabase-browser'

export type HubBucket =
  | 'meeting-media'      // meeting videos, transcripts, attachments
  | 'media-library'      // brand assets, images, docs in the Media page
  | 'journey-uploads'    // journey card file attachments
  | 'crm-files'          // CRM task attachments (already exists)
  | 'pipeline-resources' // pipeline card resources (already exists)
  | 'headshots'          // team profile photos (already exists)

export interface UploadResult {
  path: string
  publicUrl: string
  bucket: HubBucket
}

/**
 * Upload a File to Supabase Storage and return the permanent public URL.
 * Creates a unique path using orgId + timestamp + original filename.
 */
export async function uploadToStorage(
  file: File,
  bucket: HubBucket,
  orgId: string,
  folder?: string
): Promise<UploadResult> {
  const supabase = createClient()
  const ext = file.name.split('.').pop() || 'bin'
  const safe = file.name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase()
  const ts = Date.now()
  const path = folder
    ? `${orgId}/${folder}/${ts}-${safe}`
    : `${orgId}/${ts}-${safe}`

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: false, contentType: file.type })

  if (error) throw new Error(`Storage upload failed: ${error.message}`)

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(path)
  if (!urlData?.publicUrl) throw new Error('Could not get public URL')

  return { path, publicUrl: urlData.publicUrl, bucket }
}

/**
 * Delete a file from Supabase Storage.
 */
export async function deleteFromStorage(bucket: HubBucket, path: string): Promise<void> {
  const supabase = createClient()
  await supabase.storage.from(bucket).remove([path])
}

/**
 * Get a public URL for an existing storage path.
 */
export function getStorageUrl(bucket: HubBucket, path: string): string {
  const supabase = createClient()
  const { data } = supabase.storage.from(bucket).getPublicUrl(path)
  return data.publicUrl
}
