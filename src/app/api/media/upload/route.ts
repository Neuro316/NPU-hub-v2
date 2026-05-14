import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase'

export async function POST(request: NextRequest) {
  try {
    // Auth check (soft)
    let userId: string | null = null
    try {
      const supabase = createServerSupabase()
      const { data: { user } } = await supabase.auth.getUser()
      userId = user?.id || null
    } catch {}

    const formData = await request.formData()
    const file = formData.get('file') as File
    const orgId = formData.get('org_id') as string
    const collectionId = formData.get('collection_id') as string | null
    // Map org to correct brand value (CHECK constraint: 'np', 'sensorium', 'both')
    const brandValue = orgId === 'b9fd8b2e-ded6-468b-ab1e-10b50ca40629' ? 'sensorium' : 'np'

    if (!file || !orgId) {
      return NextResponse.json({ error: 'Missing file or org_id' }, { status: 400 })
    }

    const admin = createAdminSupabase()

    // Upload to Supabase Storage
    const safe = file.name.replace(/[^a-z0-9._-]/gi, '-').toLowerCase()
    const filePath = `${orgId}/assets/${Date.now()}-${safe}`

    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const { error: uploadError } = await admin.storage
      .from('media-library')
      .upload(filePath, fileBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      })

    if (uploadError) {
      console.error('[media/upload] Storage error:', uploadError)
      return NextResponse.json({ error: uploadError.message }, { status: 500 })
    }

    // Get public URL
    const { data: urlData } = admin.storage.from('media-library').getPublicUrl(filePath)

    // Generate thumbnail URL based on file type
    let thumbnailUrl: string | null = null
    if (file.type.startsWith('image/')) {
      // Supabase image transforms — resize to 400x300
      thumbnailUrl = urlData.publicUrl + '?width=400&height=300&resize=cover'
    }

    // Create database record
    const { data: assetData, error: dbError } = await admin
      .from('media_assets')
      .insert({
        org_id: orgId,
        collection_id: collectionId || null,
        name: file.name,
        url: urlData.publicUrl,
        thumbnail_url: thumbnailUrl,
        storage_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        brand: brandValue,
        created_by: userId,
      })
      .select()
      .single()

    if (dbError) {
      console.error('[media/upload] DB error:', dbError)
      await admin.storage.from('media-library').remove([filePath])
      return NextResponse.json({ error: dbError.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, asset: assetData, url: urlData.publicUrl })
  } catch (error: any) {
    console.error('[media/upload] error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
