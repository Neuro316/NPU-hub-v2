// scripts/voice/create-intelligence-service.cjs
//
// One-time setup: create (or find) the Twilio Voice Intelligence Service the Hub
// uses to transcribe answered-call recordings. Prints the Service SID. Writes
// nothing to the Hub database; the SID is stored separately on
// org_settings.crm_twilio.intelligence_service_sid.
//
//   node scripts/voice/create-intelligence-service.cjs [org_id]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local to
// load the org's Twilio credentials. Prints no credentials. Idempotent: an
// existing Service with the same UniqueName is reused, not duplicated.
//
// Settings:
//   AutoTranscribe false  the Hub requests each transcript when a recording is
//                         ready (recording-ready), so nothing else on the account
//                         gets transcribed and billed
//   DataLogging    false  Twilio may not keep the media to improve its models
//   WebhookUrl            /api/twilio/intelligence, which saves the transcript
const fs = require('fs')
const path = require('path')

const ORG = process.argv[2] || '00000000-0000-0000-0000-000000000001'
const UNIQUE_NAME = 'npu-hub-call-transcripts'
const APP_URL = 'https://hub.neuroprogeny.com'

const envFile = path.join(__dirname, '..', '..', '.env.local')
const env = Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z0-9_]+=/.test(l))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')] }))

;(async () => {
  const sbUrl = env.NEXT_PUBLIC_SUPABASE_URL, sbKey = env.SUPABASE_SERVICE_ROLE_KEY
  if (!sbUrl || !sbKey) throw new Error('.env.local needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY')
  const r = await fetch(`${sbUrl}/rest/v1/org_settings?org_id=eq.${ORG}&setting_key=eq.crm_twilio&select=setting_value`,
    { headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}` } })
  const v = (await r.json())[0]?.setting_value
  if (!v?.account_sid || !v?.auth_token) throw new Error('No Twilio credentials on this org')
  const auth = 'Basic ' + Buffer.from(`${v.account_sid}:${v.auth_token}`).toString('base64')
  const base = 'https://intelligence.twilio.com/v2/Services'

  const list = await (await fetch(`${base}?PageSize=100`, { headers: { Authorization: auth } })).json()
  const found = (list.services || []).find(s => s.unique_name === UNIQUE_NAME)
  if (found) {
    console.log('Existing Service reused.')
    console.log('SERVICE_SID=' + found.sid)
    console.log('webhook:', found.webhook_url, '| auto_transcribe:', found.auto_transcribe, '| data_logging:', found.data_logging)
    return
  }

  const body = new URLSearchParams({
    UniqueName: UNIQUE_NAME,
    FriendlyName: 'NPU Hub call transcripts',
    LanguageCode: 'en-US',
    AutoTranscribe: 'false',
    DataLogging: 'false',
    WebhookUrl: `${APP_URL}/api/twilio/intelligence`,
    WebhookHttpMethod: 'POST',
  })
  const res = await fetch(base, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  })
  const j = await res.json()
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${j.message || JSON.stringify(j)}`)
  console.log('Service created.')
  console.log('SERVICE_SID=' + j.sid)
  console.log('webhook:', j.webhook_url, '| auto_transcribe:', j.auto_transcribe, '| data_logging:', j.data_logging)
})().catch(e => { console.error('failed:', e.message); process.exit(1) })
