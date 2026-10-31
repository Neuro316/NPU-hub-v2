// Playback of call recordings through the Hub's proxy (api/comms/recording/[id]).
//
// Why this exists: answered-call recordings showed 0:00 / 0:00 and never played.
// A browser's <audio> always asks for byte ranges ("Range: bytes=0-"), and the
// proxy neither honored them nor answered in time: Vercel logged "did not return
// an initial response within 25s" for those requests, while a plain GET of the
// same recording returned in under 2 seconds. Safari on a phone also refuses
// audio from a server that cannot serve ranges. So the proxy now passes the
// range to Twilio, or slices it itself when Twilio sends the whole file.
//
// No imports: scripts/tests/recording-media.test.mjs loads this file directly.

/** Largest slice answered from a buffered recording (Vercel caps a buffered body at 4.5 MB). */
export const MAX_RANGE_BYTES = 4 * 1024 * 1024

/**
 * The Twilio media URL to play: MP3, downmixed to one channel. A dual-channel
 * call recording otherwise plays the Hub user in one ear and the contact in the
 * other; mono puts both voices in both ears. RequestedChannels=1 is valid for
 * every recording, mono or dual.
 */
export function playbackMediaUrl(url: string): string {
  const q = url.indexOf('?')
  let path = q < 0 ? url : url.slice(0, q)
  const params = new URLSearchParams(q < 0 ? '' : url.slice(q + 1))
  if (!/\.(mp3|wav)$/i.test(path)) path += '.mp3'
  params.set('RequestedChannels', '1')
  return `${path}?${params.toString()}`
}

export type ByteRange = { start: number; end: number }

/**
 * One byte range from a Range header against a known size.
 * null: no usable range (serve the whole file). 'unsatisfiable': answer 416.
 */
export function parseByteRange(header: string | null | undefined, size: number): ByteRange | 'unsatisfiable' | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m || (m[1] === '' && m[2] === '')) return null // multiple ranges or malformed: whole file
  if (m[1] === '') {
    const n = Number(m[2])
    if (n === 0 || size === 0) return 'unsatisfiable'
    return { start: Math.max(0, size - n), end: size - 1 }
  }
  const start = Number(m[1])
  if (start >= size) return 'unsatisfiable'
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (end < start) return null
  return { start, end }
}

/**
 * The response for a range request against a buffered recording of `size`
 * bytes. Long ranges are shortened to MAX_RANGE_BYTES; a browser asks again
 * for the rest, which HTTP allows.
 */
export function planRangeResponse(header: string | null | undefined, size: number):
  | { status: 200 }
  | { status: 416; headers: Record<string, string> }
  | { status: 206; start: number; end: number; headers: Record<string, string> } {
  const r = parseByteRange(header, size)
  if (r === null) return { status: 200 }
  if (r === 'unsatisfiable') return { status: 416, headers: { 'Content-Range': `bytes */${size}` } }
  const end = Math.min(r.end, r.start + MAX_RANGE_BYTES - 1)
  return {
    status: 206, start: r.start, end,
    headers: { 'Content-Range': `bytes ${r.start}-${end}/${size}`, 'Content-Length': String(end - r.start + 1) },
  }
}
