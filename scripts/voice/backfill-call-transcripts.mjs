// scripts/voice/backfill-call-transcripts.mjs
//
// One-time backfill: request Voice Intelligence transcripts for recorded ANSWERED
// calls (inbound and outbound) from the last 30 days that have none. Voicemails
// are skipped; they keep Twilio's built-in transcription.
//
//   node scripts/voice/backfill-call-transcripts.mjs            dry run, lists rows only
//   node scripts/voice/backfill-call-transcripts.mjs --apply    requests transcripts
//
// Each request marks its row transcription_status 'pending'; the transcript then
// arrives through /api/twilio/intelligence exactly like a live call's. Rows
// already 'pending' or 'completed' are skipped, so a second run does not bill
// twice. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from
// .env.local. Prints no credentials.
//
// Not run as part of the fix. Expect few or no rows: answered-call recording was
// switched off on both lines until 2026-10-31.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requestCallTranscript } from '../../src/lib/voice-intelligence.ts'

const APPLY = process.argv.includes('--apply')
const DAYS = 30
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` }
const rest = async (p, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { ...headers, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}: ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const since = new Date(Date.now() - DAYS * 86400000).toISOString()
const rows = await rest(
  'call_logs?select=id,org_id,contact_id,direction,from_number,to_number,started_at,recording_sid,transcription_status' +
  `&recording_sid=not.is.null&status=neq.voicemail&transcript=is.null&started_at=gte.${since}` +
  '&or=(transcription_status.is.null,transcription_status.eq.failed)&order=started_at.asc')
console.log(`${rows.length} recorded answered call(s) since ${since.slice(0, 10)} with no transcript.${APPLY ? '' : ' Dry run: pass --apply to request transcripts.'}`)

const configs = new Map()
const configFor = async orgId => {
  if (!configs.has(orgId)) {
    const s = await rest(`org_settings?select=setting_value&org_id=eq.${orgId}&setting_key=eq.crm_twilio`)
    configs.set(orgId, s[0]?.setting_value || null)
  }
  return configs.get(orgId)
}

let requested = 0, failed = 0, skipped = 0
for (const row of rows) {
  const direction = row.direction === 'outbound' ? 'outbound' : 'inbound'
  let label = (direction === 'outbound' ? row.to_number : row.from_number) || 'Contact'
  if (row.contact_id) {
    const c = await rest(`contacts?select=first_name,last_name&id=eq.${row.contact_id}`)
    const name = `${c[0]?.first_name || ''} ${c[0]?.last_name || ''}`.trim()
    if (name) label = name
  }
  const cfg = row.org_id ? await configFor(row.org_id) : null
  const line = `${row.started_at.slice(0, 16)} ${direction} ${label} (${row.id})`
  if (!cfg?.intelligence_service_sid || !cfg?.account_sid || !cfg?.auth_token) { skipped++; console.log('  skip, org has no Intelligence Service:', line); continue }
  if (!APPLY) { console.log('  would request:', line); continue }

  const r = await requestCallTranscript({
    creds: { accountSid: cfg.account_sid, authToken: cfg.auth_token },
    serviceSid: cfg.intelligence_service_sid, recordingSid: row.recording_sid,
    callLogId: row.id, direction, contactLabel: label,
  })
  await rest(`call_logs?id=eq.${row.id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ transcription_status: r.ok ? 'pending' : 'failed' }),
  })
  if (r.ok) { requested++; console.log('  requested:', line) } else { failed++; console.log('  FAILED:', line, r.error) }
}
if (APPLY) console.log(`Done. requested ${requested}, failed ${failed}, skipped ${skipped}.`)
