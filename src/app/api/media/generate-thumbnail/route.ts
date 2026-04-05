import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase'

// POST /api/media/generate-thumbnail — generate thumbnail for non-image assets
export async function POST(req: NextRequest) {
  try {
    const { assetId } = await req.json()
    if (!assetId) return NextResponse.json({ error: 'assetId required' }, { status: 400 })

    const admin = createAdminSupabase()
    const { data: asset } = await admin.from('media_assets').select('*').eq('id', assetId).single()
    if (!asset) return NextResponse.json({ error: 'Asset not found' }, { status: 404 })

    let thumbnailUrl: string | null = null
    const url = asset.url || ''
    const mime = asset.mime_type || ''

    // Images — use storage transform
    if (mime.startsWith('image/')) {
      thumbnailUrl = url.includes('?') ? url + '&width=400&height=300&resize=cover' : url + '?width=400&height=300&resize=cover'
    }

    // YouTube videos
    else if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
      if (match) thumbnailUrl = `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`
    }

    // Vimeo videos
    else if (url.includes('vimeo.com')) {
      try {
        const vimeoId = url.match(/vimeo\.com\/(\d+)/)?.[1]
        if (vimeoId) {
          const res = await fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}`)
          if (res.ok) {
            const data = await res.json()
            thumbnailUrl = data.thumbnail_url || null
          }
        }
      } catch {}
    }

    // Links — try OpenGraph image
    else if (url.startsWith('http') && !mime) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
        if (res.ok) {
          const html = await res.text()
          const ogMatch = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]+)"/) ||
                          html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="og:image"/)
          if (ogMatch) thumbnailUrl = ogMatch[1]
        }
      } catch {}
    }

    // Update asset
    if (thumbnailUrl) {
      await admin.from('media_assets').update({ thumbnail_url: thumbnailUrl }).eq('id', assetId)
    }

    return NextResponse.json({ thumbnailUrl })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
