// scripts/voice/fix-stuck-outbound-calls.mjs
//
// One-time correction: outbound call logs left at 'ringing' (or 'in_progress')
// before the call-status fix get their real status, duration and end time from
// Twilio's own call records.
//
//   node scripts/voice/fix-stuck-outbound-calls.mjs            dry run, prints what would change
//   node scripts/voice/fix-stuck-outbound-calls.mjs --apply    writes the corrections
//
// For each stuck row with a stamped SID (the parent browser leg), it reads the
// child leg to the contact (Calls?ParentCallSid=), which is the call that was or
// was not answered:
//   child completed                   -> completed, child duration, child end time
//   child busy / no-answer / failed /
//   canceled, or no child leg at all  -> failed (shows "Not connected"), 0 seconds
// Rows with no SID (the call never reached Twilio) become failed with 0 seconds.
// Only rows older than 15 minutes are touched, so a live call is never closed.
// Twilio GETs only. Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// from .env.local; the Twilio credentials come from each org's crm_twilio.
// Prints no credentials. Contact talk-time totals are not adjusted.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapTwilioCallStatus } from '../../src/lib/outbound-call-status.ts'

const APPLY = process.argv.includes('--apply')
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))
const SB = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SERVICE_ROLE_KEY
if (!SB || !KEY) { console.error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const rest = async (p, init = {}) => {
  const r = await fetch(`${SB}/rest/v1/${p}`, { ...init, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, ...(init.headers || {}) } })
  if (!r.ok) throw new Error(`${p.split('?')[0]} ${r.status}: ${await r.text()}`)
  return r.status === 204 ? null : r.json()
}

const cutoff = new Date(Date.now() - 15 * 60000).toISOString()
const rows = await rest('call_logs?select=id,org_id,started_at,status,external_call_sid,to_number' +
  `&direction=eq.outbound&status=in.(ringing,in_progress)&started_at=lt.${cutoff}&order=started_at.asc`)
console.log(`${rows.length} stuck outbound call log(s).${APPLY ? '' : ' Dry run: pass --apply to write.'}`)

const creds = new Map()
const credsFor = async orgId => {
  if (!creds.has(orgId)) {
    const s = await rest(`org_settings?select=setting_value&org_id=eq.${orgId}&setting_key=eq.crm_twilio`)
    const v = s[0]?.setting_value
    creds.set(orgId, v?.account_sid && v?.auth_token ? v : null)
  }
  return creds.get(orgId)
}
const twilioGet = async (v, p) => {
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${v.account_sid}${p}`, {
    headers: { Authorization: 'Basic ' + Buffer.from(`${v.account_sid}:${v.auth_token}`).toString('base64') },
  })
  if (!r.ok) throw new Error(`Twilio ${r.status}`)
  return r.json()
}

let changed = 0, skipped = 0
for (const row of rows) {
  let fix
  try {
    if (!row.external_call_sid) {
      fix = { status: 'failed', duration_seconds: 0, ended_at: row.started_at, why: 'no call SID (never reached Twilio)' }
    } else {
      const v = row.org_id ? await credsFor(row.org_id) : null
      if (!v) { skipped++; console.log('  skip, no Twilio credentials:', row.id); continue }
      const kids = (await twilioGet(v, `/Calls.json?ParentCallSid=${row.external_call_sid}`)).calls || []
      const child = kids.find(c => c.status === 'completed') || kids[0]
      if (!child) {
        const parent = await twilioGet(v, `/Calls/${row.external_call_sid}.json`)
        if (['queued', 'ringing', 'in-progress'].includes(parent.status)) { skipped++; console.log('  skip, call still live:', row.id); continue }
        fix = { status: 'failed', duration_seconds: 0, ended_at: parent.end_time ? new Date(parent.end_time).toISOString() : row.started_at, why: 'no leg to the contact' }
      } else {
        const st = mapTwilioCallStatus(child.status)
        if (st !== 'completed' && st !== 'failed') { skipped++; console.log('  skip, child leg still', child.status, row.id); continue }
        fix = {
          status: st,
          duration_seconds: st === 'completed' ? parseInt(child.duration || '0', 10) || 0 : 0,
          ended_at: child.end_time ? new Date(child.end_time).toISOString() : row.started_at,
          why: `child ${child.status}`,
        }
      }
    }
  } catch (e) {
    skipped++; console.log('  skip, lookup failed:', row.id, e.message); continue
  }
  const { why, ...fields } = fix
  console.log(`  ${row.started_at.slice(0, 16)} ${row.to_number || ''} ${row.id}: ${row.status} -> ${fields.status}, ${fields.duration_seconds}s (${why})`)
  if (!APPLY) continue
  // Guarded on the stuck status, so a row closed by the live callback meanwhile is left alone.
  await rest(`call_logs?id=eq.${row.id}&status=eq.${row.status}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(fields),
  })
  changed++
}
if (APPLY) console.log(`Done. corrected ${changed}, skipped ${skipped}.`)
