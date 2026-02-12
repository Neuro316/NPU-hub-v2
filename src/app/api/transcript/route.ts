import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

// Extract YouTube video ID from various URL formats
function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ]
  for (const p of patterns) {
    const match = input.match(p)
    if (match) return match[1]
  }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const { url, rawText } = await req.json()

    // If raw transcript text was pasted directly
    if (rawText) {
      return NextResponse.json({
        transcript: rawText,
        source: 'pasted',
        title: 'Pasted Transcript',
      })
    }

    // If a URL was provided, try to fetch YouTube transcript
    if (url) {
      const videoId = extractVideoId(url)
      if (!videoId) {
        return NextResponse.json({ error: 'Could not extract video ID from URL. Supported: YouTube links or paste transcript text directly.' }, { status: 400 })
      }

      // Fetch transcript using YouTube's timedtext API
      // First get the video page to find caption track
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      })

      if (!pageRes.ok) {
        return NextResponse.json({ error: 'Could not access YouTube video. Try pasting the transcript text directly.' }, { status: 400 })
      }

      const pageHtml = await pageRes.text()

      // Extract title
      const titleMatch = pageHtml.match(/<title>([^<]*)<\/title>/)
      const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : 'YouTube Video'

      // Find captions URL in the page data
      const captionsMatch = pageHtml.match(/"captions":\s*(\{[^}]*"playerCaptionsTracklistRenderer"[^}]*\})/)
      
      // Try to find timedtext URL directly
      const timedTextMatch = pageHtml.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"]*/)
      
      if (timedTextMatch) {
        let timedTextUrl = timedTextMatch[0].replace(/\\u0026/g, '&')
        // Ensure we get the right format
        if (!timedTextUrl.includes('fmt=')) timedTextUrl += '&fmt=json3'
        
        try {
          const captionRes = await fetch(timedTextUrl)
          if (captionRes.ok) {
            const captionData = await captionRes.json()
            const events = captionData.events || []
            const transcript = events
              .filter((e: any) => e.segs)
              .map((e: any) => {
                const text = e.segs.map((s: any) => s.utf8 || '').join('')
                const time = Math.floor((e.tStartMs || 0) / 1000)
                const mins = Math.floor(time / 60)
                const secs = time % 60
                return `[${mins}:${secs.toString().padStart(2, '0')}] ${text.trim()}`
              })
              .filter((line: string) => line.replace(/\[\d+:\d+\]\s*/, '').length > 0)
              .join('\n')

            if (transcript.length > 50) {
              return NextResponse.json({ transcript, source: 'youtube', title, videoId })
            }
          }
        } catch {}
      }

      // Fallback: try srv3 XML format
      const srv3Match = pageHtml.match(/https:\/\/www\.youtube\.com\/api\/timedtext[^"]*srv3[^"]*/)
      if (srv3Match) {
        try {
          const xmlUrl = srv3Match[0].replace(/\\u0026/g, '&')
          const xmlRes = await fetch(xmlUrl)
          if (xmlRes.ok) {
            const xmlText = await xmlRes.text()
            // Parse basic XML transcript
            const lines = xmlText.match(/<text[^>]*>([^<]*)<\/text>/g) || []
            const transcript = lines.map((line: string) => {
              const text = line.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
              return text.trim()
            }).filter(Boolean).join(' ')

            if (transcript.length > 50) {
              return NextResponse.json({ transcript, source: 'youtube-xml', title, videoId })
            }
          }
        } catch {}
      }

      return NextResponse.json({ 
        error: `Could not fetch transcript for this video. The video may not have captions enabled. Try: 1) Open the video on YouTube, 2) Click "..." then "Show transcript", 3) Copy and paste the transcript text directly.`,
        title,
        videoId,
      }, { status: 400 })
    }

    return NextResponse.json({ error: 'Provide either a URL or rawText' }, { status: 400 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch transcript' }, { status: 500 })
  }
}
