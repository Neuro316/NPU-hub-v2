#!/usr/bin/env node
// scripts/marketing/entry-wiring-tamper.cjs
//
// Proves the entry events (hub_212) are WIRED: that production code calls each hook, in
// the order that makes it safe, and that none of it writes consent. The database side
// (triggers, queue, cap, guards, merges, flag off) is proved by contract-212.sql on a
// branch; this harness proves the app reaches it. Reads source text with comments
// stripped, so a comment describing a call never counts as the call. No network.
//
// BASE=<git ref> reads every file from that ref instead of the working tree. Against the
// commit before this work (BASE=HEAD~1 on the feature commit) every case must be red:
// that is the discrimination check, and it prints the same red-set line.
//
// TAMPER=<selector> plants one defect and must redden EXACTLY the declared set:
//   nocall      ring-complete stops raising the missed-call event       {W1}
//   mergeorder  a contact merge stops pausing campaign entry first       {W3}
//   importoptin an import starts campaigns without the person choosing   {W4}
//   nosummary   a bulk stage move stops writing its job log summary      {W6}
//   hardcoded   the overview claims stages are wired without asking      {W8}
//   consent     entry event code starts writing consent                  {W10}
//   cached      the admin client lets Next.js answer rpc calls from cache {W11}
// TAMPER=1 runs every selector at once and must redden the union.
// Exit: 0 green (untampered) or the declared set reddened (tampered); 1 a red that was
// not declared; 2 unknown selector or a dead anchor; 3 a tampered run whose red set is
// not the declaration.
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process')
const ROOT = path.resolve(__dirname, '..', '..')

const FILES = {
  ring: 'src/app/api/twilio/ring-complete/route.ts',
  merge: 'src/app/api/contacts/merge/route.ts',
  importPage: 'src/app/(dashboard)/crm/import/page.tsx',
  importRoute: 'src/app/api/marketing/import-events/route.ts',
  bulk: 'src/app/api/contacts/bulk-action/route.ts',
  cron: 'src/app/api/cron/entry-events/route.ts',
  overview: 'src/app/api/marketing/overview/route.ts',
  entry: 'src/lib/marketing/entry-events.ts',
  vercel: 'vercel.json',
  migration: 'supabase/migrations/hub_212_entry_events.sql',
  supabase: 'src/lib/supabase.ts',
}
const TAMPERS = {
  nocall: [['ring', "await raiseCallEvent(params.CallSid || '', 'missed');", '']],
  mergeorder: [['merge', "if (!(await guardContacts(admin, winner.org_id, [winnerId, loserId], 'contact_merge', 10))) {", 'if (false) {']],
  importoptin: [['importPage', 'if (startCampaigns && batchId) {', 'if (batchId) {']],
  nosummary: [['bulk', "if (!err && affected) campaignNote = (await summariseBulkStageMove(supabase, orgId, stageMoveStarted, affected, user.id)).note;", '']],
  hardcoded: [['overview', 'queue: (wiring.data as any)?.queue === true,', 'queue: true,'], ['overview', 'stageTrigger: (wiring.data as any)?.stage === true,', 'stageTrigger: true,']],
  cached: [['supabase', "fetch(input, { ...init, cache: 'no-store' })", 'fetch(input, init)']],
  consent: [['entry', "export const ENTRY_CAP_PER_RUN = 100", "export const ENTRY_CAP_PER_RUN = 100\nexport const _c = (db: any) => db.rpc('record_consent', {})"]],
}
const RED_OF = { nocall: ['W1'], mergeorder: ['W3'], importoptin: ['W4'], nosummary: ['W6'], hardcoded: ['W8'], consent: ['W10'], cached: ['W11'] }
const ALL = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8', 'W9', 'W10', 'W11']

const sel = process.env.TAMPER || ''
const base = process.env.BASE || ''
const active = sel === '1' ? Object.keys(TAMPERS) : sel ? sel.split(',') : []
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }
if (base && active.length) { console.error('BASE and TAMPER are separate runs'); process.exit(2) }

function read(rel) {
  if (base) {
    try { return execFileSync('git', ['show', `${base}:${rel}`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch { return '' }
  }
  const p = path.join(ROOT, rel)
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}
// strip comments FIRST: a comment describing a call must never count as the call
const stripTs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const stripSql = (s) => s.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n')
const src = {}
for (const [k, rel] of Object.entries(FILES)) {
  let s = read(rel).replace(/\r\n/g, '\n')
  for (const t of active) for (const [file, from, to] of TAMPERS[t]) {
    if (file !== k) continue
    if (!s.includes(from)) { console.error(`dead anchor: ${t} in ${rel}`); process.exit(2) }
    s = s.split(from).join(to)
  }
  src[k] = rel.endsWith('.sql') ? stripSql(s) : rel.endsWith('.json') ? s : stripTs(s)
}

const rows = []
const check = (id, ok, note) => { rows.push({ id, ok: !!ok }); console.log(`${ok ? 'ok  ' : 'RED '} ${id}${ok ? '' : `  ${note}`}`) }
const at = (s, needle) => s.indexOf(needle)

// W1 calls: both outcomes raise, before the TwiML that ends each branch
{
  const s = src.ring
  const answered = at(s, "await raiseCallEvent(callSid, 'answered')"), hang = at(s, 'response.hangup()')
  const missed = at(s, "await raiseCallEvent(params.CallSid || '', 'missed')"), vm = at(s, 'appendVoicemail(response, { greetingUrl, greetingText, appUrl: resolveAppUrl() })')
  check('W1', /import \{ raiseEntryEvent \} from '@\/lib\/marketing\/entry-events'/.test(s) && answered > 0 && answered < hang && missed > 0 && missed < vm,
    'ring-complete does not raise both call events before its TwiML')
}
// W2 calls: keyed by the call sid, attributed by that sid, inbound only, both keys for answered
{
  const s = src.ring
  check('W2', /eventId: `call:\$\{callSid\}`/.test(s) && /\.eq\('external_call_sid', callSid\)/.test(s) && /row\.direction !== 'inbound'/.test(s)
    && /\['call:answered', 'call:inbound'\]/.test(s) && /\['call:missed'\]/.test(s), 'call events are not keyed and attributed by CallSid')
}
// W3 merge: campaign entry is paused BEFORE anything is repointed or updated, and released after
{
  const s = src.merge
  const g = at(s, "await guardContacts(admin, winner.org_id, [winnerId, loserId], 'contact_merge', 10)"), rp = at(s, "rpc('merge_contact_repoint'"), rl = at(s, "await releaseGuard(admin, [winnerId, loserId], 'contact_merge')")
  check('W3', g > 0 && g < rp && rl > rp && /if \(!\(await guardContacts\(/.test(s), 'merge does not guard before repointing')
}
// W4 import: duplicates guarded before any write; campaigns start only when the person ticked the box
{
  const s = src.importPage
  const guard = at(s, "importEvents({ action: 'guard', contact_ids: mergeIds })"), batch = at(s, "sb.from('contact_import_batches').insert(")
  const enroll = at(s, "action: 'enroll'"), gate = at(s, 'if (startCampaigns && batchId) {')
  check('W4', guard > 0 && guard < batch && gate > 0 && enroll > gate && (s.match(/action: 'enroll'/g) || []).length === 1
    && /useState\(false\)/.test(s.slice(at(s, 'const [startCampaigns'), at(s, 'const [startCampaigns') + 80)), 'import can enroll without the person choosing, or merges unguarded')
}
// W5 import route: engine flag, a listening route, the per-import maximum, one job log line
{
  const s = src.importRoute
  check('W5', /rpc\('hub_flag', \{ p_org: org, p_key: 'engine' \}\)/.test(s) && /\.eq\('source_key', sourceKey\)\.eq\('active', true\)/.test(s)
    && /all\.length > IMPORT_ENROLL_MAX/.test(s) && /withJobRun\(db, 'import-enroll'/.test(s) && /export const POST = withStaff\(/.test(s), 'import enroll route lost a safety check')
}
// W6 bulk stage moves: both stage actions write the summary
{
  const s = src.bulk
  const a = s.slice(at(s, "case 'set_pipeline_stage'"), at(s, "case 'set_pipeline':"))
  const b = s.slice(at(s, "case 'set_pipeline':"), at(s, "case 'assign_to'"))
  check('W6', /summariseBulkStageMove\(/.test(a) && /summariseBulkStageMove\(/.test(b) && /campaign_note: campaignNote/.test(s), 'a bulk stage action does not write its summary')
}
// W7 the cron: secret, the capped processor, one job log row, scheduled
{
  const s = src.cron
  let scheduled = false
  try { scheduled = (JSON.parse(src.vercel || '{}').crons || []).some((c) => c.path === '/api/cron/entry-events') } catch { scheduled = false }
  check('W7', /cronAuthorized\(req, 'cron\/entry-events'\)/.test(s) && /rpc\('process_entry_events', \{ p_limit: ENTRY_CAP_PER_RUN \}\)/.test(s)
    && /withJobRun\(db, 'entry-events'/.test(s) && scheduled, 'the entry events cron is missing, open, uncapped or unscheduled')
}
// W8 connected or not connected comes from the database, not a list
{
  const s = src.overview
  check('W8', /db\.rpc\('entry_source_status'\)/.test(s) && /queue: \(wiring\.data as any\)\?\.queue === true/.test(s)
    && /stageTrigger: \(wiring\.data as any\)\?\.stage === true/.test(s) && /setting_key', 'crm_twilio'/.test(s), 'source status is not read from the real state')
}
// W9 the migration: both triggers, the per-run cap, the flag check and the guards
{
  const s = src.migration
  check('W9', /create trigger hub_contacts_entry_events after update on public\.contacts/.test(s) && /create trigger hub_contact_tags_entry_events after insert on public\.contact_tags/.test(s)
    && /least\(coalesce\(p_limit, 100\), 500\)/.test(s) && /if public\.hub_flag\(p_org, 'engine'\) <> 'on' then return false; end if;/.test(s)
    && /from public\.entry_event_guards x/.test(s), 'hub_212 lost a trigger, the cap, the flag check or the guard')
}
// W10 nothing on the entry event path writes consent
{
  const pathSrc = [src.entry, src.importRoute, src.cron, src.ring.slice(at(src.ring, 'async function raiseCallEvent'), at(src.ring, 'export async function POST')), src.migration].join('\n')
  const bad = /record_consent|consent_events|sms_consent|email_consent|suppressions/.test(pathSrc)
  check('W10', src.entry && src.migration && !bad, 'entry event code mentions a consent write')
}

// W11 every service-role request bypasses the Next.js Data Cache (2026-10-01: a cached rpc
// left a queued event unprocessed while the cron reported success)
{
  const s = src.supabase
  const fn = s.slice(at(s, 'export function createAdminSupabase'))
  check('W11', fn.includes("fetch(input, { ...init, cache: 'no-store' })") && src.cron.includes("export const fetchCache = 'force-no-store'"), 'the admin client or the entry events cron can be answered from cache')
}

const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
if (base) {
  console.log(`\nBASE=${base}: red {${red.join(',')}}, declared {${[...ALL].sort().join(',')}}`)
  process.exitCode = JSON.stringify(red) === JSON.stringify([...ALL].sort()) ? 0 : 3
} else if (!active.length) {
  console.log(red.length ? `\nFAIL: ${red.length} red` : `\nPASS: ${rows.length} of ${rows.length}`)
  process.exitCode = red.length ? 1 : 0
} else {
  const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
  console.log(`\nTAMPER=${sel}: red {${red.join(',')}}, declared {${want.join(',')}}`)
  if (!red.length) { console.error('FATAL: a TAMPERED run PASSED.'); process.exitCode = 3 }
  else if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exitCode = 3 }
  else process.exitCode = 0
}
