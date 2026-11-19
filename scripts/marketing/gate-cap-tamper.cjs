#!/usr/bin/env node
// scripts/marketing/gate-cap-tamper.cjs   (hub_243: the frequency cap is skipped for test contacts in dry run only)
//
// Reads supabase/migrations/hub_243_test_contact_cap_exempt.sql. There is no database here, so the checks work on
// the migration's own text: they pull out the cap condition and the allowlist lookup from the new gate_check and
// evaluate them for each case, and they prove by md5 that nothing else in the function changed and that the
// rollback restores today's definition exactly. Checks, from intent:
//   G_TEST_DRY   an allowlisted test contact in DRY RUN skips the cap (a test drive can check every campaign)
//   G_TEST_LIVE  the same test contact in LIVE mode is still capped
//   G_REAL_DRY   a real contact in dry run is still capped; the lookup is the org's campaign_test_contacts, matched
//                on the contact's own email (or phone), never everyone
//   G_UNCHANGED  undoing only the hub_243 lines gives back today's production definition (md5 69b7a1b0...), so
//                quiet hours, consent, suppression and the rest are unchanged
//   G_ROLLBACK   the commented rollback is today's definition exactly (same md5), and the apply guard checks for it
//
//   capall       the allowlist lookup never reaches v_test_contact, so the test contact is capped in dry run  {G_TEST_DRY}
//   livetoo      the exemption ignores the mode                              {G_TEST_LIVE}
//   anyone       the lookup matches any contact                              {G_REAL_DRY}
//   otherchange  another line of the gate changes (quiet hours)              {G_UNCHANGED}
//   badrollback  the rollback text drifts from today's definition            {G_ROLLBACK}
// TAMPER=1 reddens the sum (5).
const fs = require('fs'), path = require('path'), crypto = require('crypto')
const H = require('../agent/lib/harness.cjs')

const FILE = 'supabase/migrations/hub_243_test_contact_cap_exempt.sql'
const OLD_MD5 = '69b7a1b0becd612049560e5ae08e9875'   // public.gate_check on production and nonprod, read 2026-11-18
const OLD_CAP_IF = "    if p_kind = 'marketing' then"
const STEP5 = '    -- 5. frequency cap, marketing only, across channels and across merged contacts'
const DECLARE = '  v_test_contact boolean := false;  -- HUB_243'

const TAMPERS = {
  capall: [['        into v_test_contact;', '        into v_n;']],
  livetoo: [["    if p_kind = 'marketing' and v_mode = 'dry_run' then\n      select exists", "    if p_kind = 'marketing' then\n      select exists"],
            ["    if p_kind = 'marketing' and not (v_mode = 'dry_run' and v_test_contact) then", "    if p_kind = 'marketing' and not (v_test_contact) then"]],
  anyone: [["lower(btrim(t.email)) = lower(btrim(c.email))", 'true']],
  otherchange: [["\n    v_start := (pol ->> 'quiet_start')::time;", "\n    v_start := '00:00'::time;"]],
  badrollback: [['-- ROLLBACK BEGIN\n-- CREATE OR REPLACE FUNCTION public.gate_check(', '-- ROLLBACK BEGIN\n-- CREATE OR REPLACE FUNCTION public.gate_check (']],
}
const RED_OF = { capall: ['G_TEST_DRY'], livetoo: ['G_TEST_LIVE'], anyone: ['G_REAL_DRY'], otherchange: ['G_UNCHANGED'], badrollback: ['G_ROLLBACK'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(RED_OF) : sel ? sel.split(',') : []
for (const t of active) if (!RED_OF[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

let sql = fs.readFileSync(path.join(H.ROOT, FILE), 'utf8')
for (const t of active) for (const [from, to] of TAMPERS[t]) {
  if (!sql.includes(from)) { console.error(`dead anchor: ${t}`); process.exit(2) }
  sql = sql.split(from).join(to)
}
const md5 = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex')

// the new definition (uncommented) and the rollback (commented) as pg_get_functiondef prints them
const start = sql.indexOf('\nCREATE OR REPLACE FUNCTION public.gate_check(')
const end = sql.indexOf('end $function$;', start)
const NEW = start > 0 && end > 0 ? sql.slice(start + 1, end) + 'end $function$\n' : ''
const rb = /-- ROLLBACK BEGIN\n([\s\S]*?)-- ROLLBACK END/.exec(sql)
const ROLLBACK = rb ? rb[1].split('\n').filter((l, i, a) => i < a.length - 1).map((l) => l.replace(/^-- ?/, '')).join('\n').replace(/;$/, '') + '\n' : ''

// the parts of step 5, as written in the new definition: the guard, the allowlist lookup, the cap condition
const lines = NEW.split('\n')
const step5 = lines.indexOf(STEP5)
const capAt = lines.findIndex((l) => l.trim().startsWith('select count(*) into v_n'))
const capIf = capAt > 0 ? lines[capAt - 1] : ''
const lookupStart = lines.findIndex((l, i) => i > step5 && i < capAt && l.trim().startsWith('select exists (select 1 from public.campaign_test_contacts'))
const lookupEnd = lookupStart >= 0 ? lines.findIndex((l, i) => i >= lookupStart && /\binto\b/.test(l)) : -1
const lookupText = lookupStart >= 0 && lookupEnd >= 0 ? lines.slice(lookupStart, lookupEnd + 1).join('\n') : ''
const lookupAssigns = lookupEnd >= 0 && /\binto v_test_contact;/.test(lines[lookupEnd])
const guardIf = lookupStart > 0 ? lines[lookupStart - 1] : ''

function sqlCond(line) {
  const m = /^\s*if (.*) then$/.exec(line)
  if (!m) return () => true
  const js = m[1].replace(/\band\b/g, '&&').replace(/\bor\b/g, '||').replace(/\bnot\b/g, '!').replace(/ = /g, ' === ')
  try { return new Function('p_kind', 'v_mode', 'v_test_contact', `return (${js})`) } catch { return () => true }
}
const capCond = sqlCond(capIf), guardCond = sqlCond(guardIf)
// the lookup is the org's allowlist matched on the contact's own address, never everyone
const lookupScoped = /public\.campaign_test_contacts t where t\.org_id = c\.org_id/.test(lookupText) && /lower\(btrim\(t\.email\)\) = lower\(btrim\(c\.email\)\)/.test(lookupText)
const isCapped = (mode, testContact) => !!capCond('marketing', mode, testContact)

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

// each check looks at its own part, so one wrong part never hides another
check('G_TEST_DRY', NEW && guardCond('marketing', 'dry_run', false) && lookupAssigns && isCapped('dry_run', true) === false,
  { guard: guardIf.trim(), lookupAssigns, capIf: capIf.trim() })
check('G_TEST_LIVE', NEW && isCapped('live', true) === true,
  { guard: guardIf.trim(), capIf: capIf.trim() })
check('G_REAL_DRY', NEW && lookupScoped && isCapped('dry_run', false) === true && isCapped('live', false) === true,
  { lookupScoped })

// G_UNCHANGED: drop the declare line and the hub_243 block, put back the original cap line: today's definition
{
  const out = []
  let i = 0, skipping = false, ok = true
  for (; i < lines.length; i++) {
    const l = lines[i]
    if (l === DECLARE) continue
    if (l === STEP5) { out.push(l); skipping = true; continue }
    if (skipping) {
      if (lines[i + 1] && lines[i + 1].trim().startsWith('select count(*) into v_n')) { out.push(OLD_CAP_IF); skipping = false }
      continue
    }
    out.push(l)
  }
  if (skipping) ok = false
  const restored = out.join('\n')
  check('G_UNCHANGED', ok && md5(restored) === OLD_MD5, { md5: md5(restored) })
}

// G_ROLLBACK: the rollback is today's definition, and the apply guard checks for exactly that md5
{
  const guard = /md5\(pg_get_functiondef\('public\.gate_check\(uuid,text,text,uuid,timestamp with time zone\)'::regprocedure\)\)\s*<> '([0-9a-f]{32})'/.exec(sql)
  check('G_ROLLBACK', md5(ROLLBACK) === OLD_MD5 && guard && guard[1] === OLD_MD5, { rollbackMd5: md5(ROLLBACK), guard: guard?.[1] })
}

H.report(rows, active, RED_OF)
