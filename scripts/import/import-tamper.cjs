#!/usr/bin/env node
// scripts/import/import-tamper.cjs   (scripts/import/contacts-from-csv.cjs, the contacts import, 2026-11-23)
//
// The script only writes SQL, so this harness runs the REAL script (parse, normalise, build) on a fixed CSV and checks
// the SQL it emits for each property, from intent. The same SQL was run once against nonprod inside a block that ended
// in an exception (so nothing persisted) to see the behaviour: see the PR report.
//   I_MATCH_EMAIL    an existing contact is matched by email first: lower(btrim(email)) or custom_fields.alt_emails, and
//                    an address the Hub's isUsableEmail refuses ('test') is never used
//   I_MATCH_PHONE    with no email match, the Hub's own match_contact_by_phone (last 10 digits) is asked, and only then
//   I_FILL_BLANKS    a match fills blanks only: name, email and phone change only when empty, and consent, the consent
//                    date and the pipeline stage are never written by the update
//   I_NO_DUP_POSITION the pipeline position is inserted only when there is none in that pipeline (on conflict do nothing)
//   I_CREATED_AT     a new contact's created_at is the row's activity_date when given, else now(); and it carries the
//                    import batch id
//
//   emailcase     the email is matched as typed, not lowered, and refused addresses pass   {I_MATCH_EMAIL}
//   phonefirst    the phone matcher runs even when the email matched                     {I_MATCH_PHONE}
//   overwrite     a match overwrites the name                                            {I_FILL_BLANKS}
//   dupposition   the position insert moves an existing stage                            {I_NO_DUP_POSITION}
//   nowcreated    created_at is always now()                                             {I_CREATED_AT}
// TAMPER=1 reddens the sum (5).
const fs = require('fs')
const os = require('os')
const path = require('path')
const H = require('../agent/lib/harness.cjs')

const SCRIPT = path.join(__dirname, 'contacts-from-csv.cjs')
const TAMPERS = {
  emailcase: [["  const email = email0 && isUsableEmail(email0) ? email0.toLowerCase() : null", '  const email = email0']],
  phonefirst: [['    if v_id is null and r.phone is not null then\n      v_id := public.match_contact_by_phone(v_org, r.phone);', '    if r.phone is not null then\n      v_id := public.match_contact_by_phone(v_org, r.phone);']],
  overwrite: [["        first_name = case when coalesce(btrim(c.first_name), '') = '' then coalesce(r.first_name, c.first_name) else c.first_name end,", '        first_name = coalesce(r.first_name, c.first_name),']],
  dupposition: [['        on conflict (contact_id, pipeline_id) do nothing;', '        on conflict (contact_id, pipeline_id) do update set stage_id = excluded.stage_id;']],
  nowcreated: [['              coalesce(r.activity_date, now()))', '              now())']],
}
const RED_OF = { emailcase: ['I_MATCH_EMAIL'], phonefirst: ['I_MATCH_PHONE'], overwrite: ['I_FILL_BLANKS'], dupposition: ['I_NO_DUP_POSITION'], nowcreated: ['I_CREATED_AT'] }
const active = H.selectors(TAMPERS)
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

// the script, with the active tampers applied, in a temp file next to nothing else (it requires typescript and fs only)
let src = fs.readFileSync(SCRIPT, 'utf8')
for (const t of active) for (const [from, to] of TAMPERS[t]) {
  if (!src.includes(from)) { console.error(`dead anchor: ${t}`); process.exit(2) }
  src = src.split(from).join(to)
}
src = src.replace("path.join(__dirname, '..', '..', 'src', 'lib', 'contacts', 'match.ts')", JSON.stringify(path.join(H.SRC, 'lib', 'contacts', 'match.ts')))
  .replace("require('typescript')", `require(${JSON.stringify(require.resolve('typescript'))})`)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-import-'))
const file = path.join(dir, 'contacts-from-csv.cjs')
fs.writeFileSync(file, src)
const imp = require(file)

const CSV = `first_name,last_name,email,phone,tags,source,note,pipeline,stage,email_consent,text_consent,text_consent_at,company,city,state,activity_date,owner_user_id
Ana,Lee, Ana.Lee@Example.com ,(828) 555-0101,sensorium|clinic,sensorium_import,"Met at the expo, wants a call",Sales Pipeline,New Lead,true,false,,Clinic A,Asheville,NC,2025-03-14,
Ben,Ray,test,5550109003,sensorium,sensorium_import,,,,,true,2025-05-01T10:00:00Z,,,,,
`
const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

const isUsableEmail = imp.hubEmailRule()
const parsed = imp.parseCsv(CSV).map((r) => imp.normalise(r, isUsableEmail))
const norm = parsed.map((p) => p.row)
const sql = imp.buildSql({ orgId: '00000000-0000-0000-0000-000000000001', batchName: 'Harness batch', rows: norm })
const block = (from, to) => { const a = sql.indexOf(from), b = sql.indexOf(to, a); return a < 0 || b < 0 ? '' : sql.slice(a, b) }
const update = block('update public.contacts c set', 'where c.id = v_id;')

check('I_MATCH_EMAIL', norm[0].email === 'ana.lee@example.com' && norm[1].email === null
  && /lower\(btrim\(c\.email\)\) = r\.email or coalesce\(c\.custom_fields->'alt_emails', '\[\]'::jsonb\) \? r\.email/.test(sql)
  && sql.indexOf('lower(btrim(c.email)) = r.email') < sql.indexOf('match_contact_by_phone'), { emails: norm.map((r) => r.email) })

check('I_MATCH_PHONE', /if v_id is null and r\.phone is not null then\s+v_id := public\.match_contact_by_phone\(v_org, r\.phone\);/.test(sql)
  && (sql.match(/match_contact_by_phone/g) || []).length === 1, 'phone matcher call')

const blankOnly = ['first_name', 'last_name', 'email', 'phone'].every((f) => new RegExp(`${f}\\s*= case when coalesce\\(btrim\\(c\\.${f}\\), ''\\) = '' then`).test(update))
check('I_FILL_BLANKS', update && blankOnly && !/email_consent|sms_consent|stage_id|pipeline/.test(update) && /tags\s*= \(select coalesce\(array_agg\(distinct x/.test(update), { blankOnly })

check('I_NO_DUP_POSITION', /insert into public\.contact_pipeline_positions[\s\S]*?on conflict \(contact_id, pipeline_id\) do nothing;/.test(sql)
  && !/contact_pipeline_positions[\s\S]{0,300}do update/.test(sql) && !/update public\.contact_pipeline_positions/.test(sql), 'position insert')

check('I_CREATED_AT', /coalesce\(r\.activity_date, now\(\)\)\)\s+returning id into v_id;/.test(sql) && sql.includes("'2025-03-14T00:00:00.000Z'::timestamptz")
  && /import_batch_id, created_at\)/.test(sql) && /v_owner, v_batch,\s+coalesce\(r\.activity_date, now\(\)\)/.test(sql), 'created_at')

H.report(rows, active, RED_OF, () => fs.rmSync(dir, { recursive: true, force: true }))
