// src/lib/sms-split.ts
// Pure SMS body splitter. No I/O, no imports, so it can be tested in isolation.
//
// Twilio refuses a body whose concatenated segments exceed its limit (error 21617),
// so a long body is sent as several texts. Each part is at most `max` characters
// (UTF-16 units, the way JavaScript and Twilio both count), prefix included.

export const SMS_PART_MAX = 1500

/**
 * Split a body into parts of at most `max` characters. Breaks on blank lines
 * first, then sentence ends, then a hard slice, so a body with neither still
 * splits. Each part carries a "(i/n) " prefix only when there is more than one
 * part, and the prefix counts inside `max`. The prefix width depends on n
 * ("(9/9) " is 6, "(10/10) " is 8), so the split is repeated until the part
 * count stops changing.
 *
 * An empty or whitespace-only body returns []: there is nothing to send.
 */
export function splitSmsBody(body: string, max: number = SMS_PART_MAX): string[] {
  const text = String(body ?? '').trim()
  if (!text) return []
  if (text.length <= max) return [text]
  let n = 2
  for (;;) {
    const width = `(${n}/${n}) `.length
    const chunks = pack(text, max - width, 0)
    if (String(chunks.length).length <= String(n).length) {
      return chunks.map((c, i) => `(${i + 1}/${chunks.length}) ${c}`)
    }
    n = chunks.length
  }
}

// Level 0 keeps a blank line attached to the paragraph before it; level 1
// keeps sentence punctuation (and any closing quote or bracket) with its sentence.
const SPLITTERS = [/(?<=\n[ \t]*\n)/, /(?<=[.!?]["')\]]*\s)/]

function pack(text: string, max: number, level: number): string[] {
  if (text.length <= max) return text.trim() ? [text.trim()] : []
  if (level >= SPLITTERS.length) {
    const out: string[] = []
    let rest = text.trim()
    while (rest.length > max) {
      let cut = max
      const c = rest.charCodeAt(cut - 1)
      if (c >= 0xd800 && c <= 0xdbff) cut--   // never split a surrogate pair (an emoji)
      out.push(rest.slice(0, cut).trim())
      rest = rest.slice(cut).trim()
    }
    if (rest) out.push(rest)
    return out.filter(Boolean)
  }
  const out: string[] = []
  let cur = ''
  for (const unit of text.split(SPLITTERS[level])) {
    if ((cur + unit).trim().length <= max) { cur += unit; continue }
    if (cur.trim()) out.push(cur.trim())
    cur = ''
    if (unit.trim().length <= max) cur = unit
    else out.push(...pack(unit, max, level + 1))
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}
