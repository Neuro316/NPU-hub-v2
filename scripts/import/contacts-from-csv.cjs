#!/usr/bin/env node
// scripts/import/contacts-from-csv.cjs
//
// Turns a contacts CSV into the SQL that imports it. The script NEVER connects to a database and never runs the SQL:
// it writes it to a file for a person to read and run, nonprod (cpasntagxhxitavivwlb) first, then production on a
// separate go through the Hub chat.
//
//   usage: node scripts/import/contacts-from-csv.cjs <input.csv> <output.sql> --org <org uuid> --batch "<batch name>"
//          [--imported-by <auth user uuid>] [--batch-size 500]
//
// CSV columns (header row, any order): first_name, last_name, email, phone, tags (pipe-separated), source, note,
// pipeline, stage, email_consent (true/false), text_consent (true/false), text_consent_at, company, city, state,
// activity_date, owner_user_id.
//
// Each batch of --batch-size rows (500) is ONE do block that:
//   - sets app.suppress_enrollment_trigger on (no campaign enrolment, no entry events) and app.hub_pipeline_source to
//     the batch name (the placement history source); nothing here texts, emails or enrols anyone
//   - finds or creates the named contact_import_batches row (by org and filename)
//   - matches an existing live contact by email, the Hub intake rule (lower(btrim(email)), hub_intake_contact), plus
//     custom_fields.alt_emails (the addresses a merge keeps), then by phone through the Hub's own
//     public.match_contact_by_phone (the last 10 digits). An email the Hub's isUsableEmail
//     (src/lib/contacts/match.ts) refuses ('test', 'none@none.com') is not used to match or stored.
//   - on a match fills blanks only: name, email, phone, company, source, owner, city and state are set only where empty;
//     consent and pipeline stage are never touched; tags are merged
//   - on no match inserts the contact with import_batch_id (so it is never a fresh lead: isImportedLead in
//     src/lib/metrics/collect.ts), created_at = activity_date when given, else now(), and the owner's team member
//   - adds one system contact_note with the note, when there is one
//   - places the contact in the named pipeline and stage only when it has no position in that pipeline
//     (on conflict do nothing); with no stage named, the pipeline's first stage
//   - raises a notice with the batch's counts: new, updated, placed, not placed
// A row that cannot be read (no email and no phone, a bad date, a bad boolean, a bad owner id) stops the script before
// anything is written, with the row numbers.
const fs = require('fs')
const path = require('path')
const ts = require('typescript')

const COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'tags', 'source', 'note', 'pipeline', 'stage', 'email_consent', 'text_consent',
  'text_consent_at', 'company', 'city', 'state', 'activity_date', 'owner_user_id']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DEFAULT_BATCH_SIZE = 500

/** The Hub's own email rule, loaded from its source so there is one definition (src/lib/contacts/match.ts). */
function hubEmailRule() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'lib', 'contacts', 'match.ts'), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  const m = { exports: {} }
  new Function('module', 'exports', 'require', js)(m, m.exports, require)
  return m.exports.isUsableEmail
}

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const s = String(text).replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some((v) => v !== '')) rows.push(row)
  if (!rows.length) return []
  const head = rows[0].map((h) => h.trim().toLowerCase())
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])))
}

const blank = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim())
function bool(v) {
  const t = blank(v)
  if (t === null) return { ok: true, value: null }
  if (/^(true|yes|y|1)$/i.test(t)) return { ok: true, value: true }
  if (/^(false|no|n|0)$/i.test(t)) return { ok: true, value: false }
  return { ok: false }
}
function date(v) {
  const t = blank(v)
  if (t === null) return { ok: true, value: null }
  const ms = Date.parse(t)
  return Number.isNaN(ms) ? { ok: false } : { ok: true, value: new Date(ms).toISOString() }
}

/** One CSV row, checked and normalised. Returns { row } or { error }. */
function normalise(raw, isUsableEmail) {
  const email0 = blank(raw.email)
  const email = email0 && isUsableEmail(email0) ? email0.toLowerCase() : null
  const phone = blank(raw.phone)
  const problems = []
  if (!email && !(phone && phone.replace(/\D/g, '').length >= 10)) problems.push('no usable email or phone')
  const ec = bool(raw.email_consent), tc = bool(raw.text_consent), tca = date(raw.text_consent_at), ad = date(raw.activity_date)
  if (!ec.ok) problems.push('email_consent is not true or false')
  if (!tc.ok) problems.push('text_consent is not true or false')
  if (!tca.ok) problems.push('text_consent_at is not a date')
  if (!ad.ok) problems.push('activity_date is not a date')
  const owner = blank(raw.owner_user_id)
  if (owner && !UUID.test(owner)) problems.push('owner_user_id is not a uuid')
  if (problems.length) return { error: problems.join('; ') }
  const tags = Array.from(new Set(String(raw.tags ?? '').split('|').map((t) => t.trim()).filter(Boolean)))
  return { row: {
    first_name: blank(raw.first_name), last_name: blank(raw.last_name), email, phone, tags, source: blank(raw.source), note: blank(raw.note),
    pipeline: blank(raw.pipeline), stage: blank(raw.stage), email_consent: ec.value, text_consent: tc.value, text_consent_at: tca.value,
    company: blank(raw.company), city: blank(raw.city), state: blank(raw.state), activity_date: ad.value, owner_user_id: owner,
  } }
}

// ── SQL literals ──────────────────────────────────────────────────────────────────────────────────────────────────
const q = (v) => `'${String(v).replace(/'/g, "''")}'`
const lit = {
  text: (v) => (v === null || v === undefined ? 'null::text' : `${q(v)}::text`),
  bool: (v) => (v === null || v === undefined ? 'null::boolean' : v ? 'true' : 'false'),
  ts: (v) => (v ? `${q(v)}::timestamptz` : 'null::timestamptz'),
  uuid: (v) => (v ? `${q(v)}::uuid` : 'null::uuid'),
  tags: (v) => (v && v.length ? `array[${v.map(q).join(', ')}]::text[]` : "'{}'::text[]"),
}
const valuesRow = (r) => `(${[lit.text(r.first_name), lit.text(r.last_name), lit.text(r.email), lit.text(r.phone), lit.tags(r.tags), lit.text(r.source),
  lit.text(r.note), lit.text(r.pipeline), lit.text(r.stage), lit.bool(r.email_consent), lit.bool(r.text_consent), lit.ts(r.text_consent_at),
  lit.text(r.company), lit.text(r.city), lit.text(r.state), lit.ts(r.activity_date), lit.uuid(r.owner_user_id)].join(', ')})`

/** One batch: one do block. `n` is the batch number, `total` the rows in the whole file. */
function batchSql({ orgId, batchName, importedBy, n, of, total, rows }) {
  return `-- batch ${n} of ${of}: ${rows.length} rows
do $import$
declare
  v_org uuid := ${q(orgId)}::uuid;
  v_batch uuid; v_id uuid; v_pipe uuid; v_stage uuid; v_owner uuid; k int;
  n_new int := 0; n_upd int := 0; n_place int := 0; n_unplaced int := 0;
  r record;
begin
  -- never texts, emails or enrols: the enrolment and entry-event triggers stand down; placements carry the batch name
  perform set_config('app.suppress_enrollment_trigger', 'on', true);
  perform set_config('app.hub_pipeline_source', ${q(batchName)}, true);

  select b.id into v_batch from public.contact_import_batches b where b.org_id = v_org and b.filename = ${q(batchName)} order by b.created_at limit 1;
  if v_batch is null then
    insert into public.contact_import_batches (org_id, imported_by, filename, total_rows, imported_rows, skipped_rows, status, notes)
    values (v_org, ${lit.uuid(importedBy)}, ${q(batchName)}, ${total}, 0, 0, 'completed', 'scripts/import/contacts-from-csv.cjs')
    returning id into v_batch;
  end if;

  for r in select * from (values
    ${rows.map(valuesRow).join(',\n    ')}
  ) as t(first_name, last_name, email, phone, tags, source, note, pipeline, stage, email_consent, text_consent, text_consent_at,
         company, city, state, activity_date, owner_user_id)
  loop
    v_id := null; v_owner := null;
    if r.owner_user_id is not null then
      select tm.id into v_owner from public.team_members tm where tm.org_id = v_org and tm.user_id = r.owner_user_id and tm.is_active limit 1;
    end if;
    -- match: email (the intake rule, and the addresses a merge keeps), then the Hub's phone matcher (last 10 digits)
    if r.email is not null then
      select c.id into v_id from public.contacts c
       where c.org_id = v_org and c.merged_into_id is null and c.archived_at is null
         and (lower(btrim(c.email)) = r.email or coalesce(c.custom_fields->'alt_emails', '[]'::jsonb) ? r.email)
       order by c.created_at limit 1;
    end if;
    if v_id is null and r.phone is not null then
      v_id := public.match_contact_by_phone(v_org, r.phone);
    end if;

    if v_id is not null then
      -- fill blanks only; consent and stage are never touched; tags are merged
      update public.contacts c set
        first_name = case when coalesce(btrim(c.first_name), '') = '' then coalesce(r.first_name, c.first_name) else c.first_name end,
        last_name  = case when coalesce(btrim(c.last_name), '') = '' then coalesce(r.last_name, c.last_name) else c.last_name end,
        email      = case when coalesce(btrim(c.email), '') = '' then coalesce(r.email, c.email) else c.email end,
        phone      = case when coalesce(btrim(c.phone), '') = '' then coalesce(r.phone, c.phone) else c.phone end,
        company    = case when coalesce(btrim(c.company), '') = '' then coalesce(r.company, c.company) else c.company end,
        source     = case when coalesce(btrim(c.source), '') = '' then coalesce(r.source, c.source) else c.source end,
        assigned_to = coalesce(c.assigned_to, v_owner),
        tags       = (select coalesce(array_agg(distinct x order by x), '{}') from unnest(coalesce(c.tags, '{}') || r.tags) as x),
        custom_fields = coalesce(c.custom_fields, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'city',  case when coalesce(c.custom_fields, '{}'::jsonb) ? 'city' then null else r.city end,
          'state', case when coalesce(c.custom_fields, '{}'::jsonb) ? 'state' then null else r.state end)),
        updated_at = now()
       where c.id = v_id;
      n_upd := n_upd + 1;
    else
      insert into public.contacts (org_id, first_name, last_name, email, phone, tags, source, company, email_consent, sms_consent, sms_consent_at,
                                   custom_fields, assigned_to, import_batch_id, created_at)
      values (v_org, coalesce(r.first_name, 'Unknown'), coalesce(r.last_name, ''), r.email, r.phone, r.tags, coalesce(r.source, 'import'), r.company,
              coalesce(r.email_consent, false), coalesce(r.text_consent, false), case when r.text_consent then r.text_consent_at end,
              jsonb_strip_nulls(jsonb_build_object('city', r.city, 'state', r.state)), v_owner, v_batch,
              coalesce(r.activity_date, now()))
      returning id into v_id;
      n_new := n_new + 1;
    end if;

    if r.note is not null then
      insert into public.contact_notes (org_id, contact_id, body, type) values (v_org, v_id, r.note, 'system');
    end if;

    -- place only when the contact has no position in that pipeline: an existing stage is never moved
    if r.pipeline is not null then
      v_pipe := null; v_stage := null;
      select p.id into v_pipe from public.pipelines p
       where p.org_id = v_org and p.archived_at is null and (lower(p.name) = lower(r.pipeline) or lower(p.legacy_key) = lower(r.pipeline))
       order by p.position limit 1;
      if v_pipe is not null then
        select s.id into v_stage from public.pipeline_stages s
         where s.pipeline_id = v_pipe and s.archived_at is null
           and (r.stage is null or lower(s.name) = lower(r.stage) or lower(s.legacy_key) = lower(r.stage))
         order by s.position limit 1;
      end if;
      if v_pipe is not null and v_stage is not null then
        insert into public.contact_pipeline_positions (org_id, contact_id, pipeline_id, stage_id, source)
        values (v_org, v_id, v_pipe, v_stage, ${q(batchName)})
        on conflict (contact_id, pipeline_id) do nothing;
        get diagnostics k = row_count;
        n_place := n_place + k;
      else
        n_unplaced := n_unplaced + 1;
      end if;
    end if;
  end loop;

  update public.contact_import_batches set imported_rows = coalesce(imported_rows, 0) + n_new + n_upd where id = v_batch;
  raise notice 'batch ${n} of ${of}: new %, updated %, placed %, not placed (pipeline or stage not found) %', n_new, n_upd, n_place, n_unplaced;
end
$import$;
`
}

/** The whole file: a header, then one do block per batch. */
function buildSql({ orgId, batchName, importedBy = null, rows, batchSize = DEFAULT_BATCH_SIZE }) {
  const chunks = []
  for (let i = 0; i < rows.length; i += batchSize) chunks.push(rows.slice(i, i + batchSize))
  const head = `-- Generated by scripts/import/contacts-from-csv.cjs on ${new Date().toISOString()}.
-- Batch "${batchName.replace(/\n/g, ' ')}", org ${orgId}: ${rows.length} rows in ${chunks.length} block(s) of at most ${batchSize}.
-- NOT RUN by the script. Run it on nonprod (cpasntagxhxitavivwlb) first, read the notices, then production on a separate
-- go through the Hub chat. It never texts, emails or enrols anyone.
`
  return head + chunks.map((rs, i) => batchSql({ orgId, batchName, importedBy, n: i + 1, of: chunks.length, total: rows.length, rows: rs })).join('\n')
}

function args(argv) {
  const pos = [], opt = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { opt[argv[i].slice(2)] = argv[i + 1]; i++ } else pos.push(argv[i])
  }
  return { pos, opt }
}

function main() {
  const { pos, opt } = args(process.argv.slice(2))
  const usage = 'usage: node scripts/import/contacts-from-csv.cjs <input.csv> <output.sql> --org <org uuid> --batch "<batch name>" [--imported-by <auth user uuid>] [--batch-size 500]'
  if (pos.length !== 2 || !opt.org || !UUID.test(opt.org) || !opt.batch) { console.error(usage); process.exit(2) }
  if (opt['imported-by'] && !UUID.test(opt['imported-by'])) { console.error('--imported-by must be a uuid'); process.exit(2) }
  const size = opt['batch-size'] ? Number(opt['batch-size']) : DEFAULT_BATCH_SIZE
  if (!(size >= 1 && size <= 500)) { console.error('--batch-size must be 1 to 500'); process.exit(2) }
  const raw = parseCsv(fs.readFileSync(pos[0], 'utf8'))
  const missing = COLUMNS.filter((c) => raw.length && !(c in raw[0]))
  if (missing.length) console.error(`note: these columns are not in the file and are read as blank: ${missing.join(', ')}`)
  const isUsableEmail = hubEmailRule()
  const rows = [], errors = []
  raw.forEach((r, i) => { const out = normalise(r, isUsableEmail); if (out.error) errors.push(`row ${i + 2}: ${out.error}`); else rows.push(out.row) })
  if (errors.length) { console.error(`${errors.length} row(s) cannot be imported; nothing was written:\n${errors.slice(0, 50).join('\n')}`); process.exit(1) }
  fs.writeFileSync(pos[1], buildSql({ orgId: opt.org, batchName: opt.batch, importedBy: opt['imported-by'] ?? null, rows, batchSize: size }))
  console.log(`wrote ${pos[1]}: ${rows.length} rows in ${Math.ceil(rows.length / size)} block(s). Not run: read it, then run it on nonprod first.`)
}

module.exports = { parseCsv, normalise, buildSql, batchSql, hubEmailRule, COLUMNS }
if (require.main === module) main()
