#!/usr/bin/env node
// scripts/settings/browser-writes-tamper.cjs   (2026-11-16, PR #44)
//
// org_settings and team_profiles are written only by server routes (src/app/api), which check staff or admin and
// use the service role. pf_304 already refuses browser writes to org_settings (so they failed silently), and
// hub_232 refuses browser writes to team_profiles by non-admins. This keeps the code from drifting back.
//
//   B_ORG      no file outside src/app/api writes org_settings (insert, update, upsert, delete)
//   B_TEAM     no file outside src/app/api writes team_profiles
//   B_ALLOW    the two server modules allowed to write org_settings outside src/app/api (ALLOWED below) are server
//              only: no 'use client', and imported only from src/app/api or from other non-client src/lib files
//   B_DETECT   the scanner catches every write shape (one line, a chain over several lines, each verb) and does not
//              flag a read
//
//   plantorg      a client component upserts org_settings                     {B_ORG}
//   plantteam     a hook inserts into team_profiles                           {B_TEAM}
//   clientimport  a client component imports an allowed server module        {B_ALLOW}
//   weak          the scanner only sees a write on the same line as from()    {B_DETECT}
//                 (multi-line chains are B_DETECT's controls; the planted writes are one line, so selectors stay disjoint)
// TAMPER=1 reddens the sum (4). The checks read the source tree as it is, plus the planted files.
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const TAMPERS = { plantorg: [], plantteam: [], clientimport: [], weak: [] }
const RED_OF = { plantorg: ['B_ORG'], plantteam: ['B_TEAM'], clientimport: ['B_ALLOW'], weak: ['B_DETECT'] }
const active = H.selectors(TAMPERS)
for (const t of active) if (!TAMPERS[t]) { console.error(`unknown selector ${t}`); process.exit(2) }
const on = (t) => active.includes(t)

/** Server-only modules outside src/app/api that write org_settings with a service-role client passed in. */
const ALLOWED = new Set(['src/lib/org-vault.ts', 'src/lib/lead-devices/provision.ts'])

const SRC = path.join(H.ROOT, 'src')
const files = new Map()
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e.name)) files.set(path.relative(H.ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'))
  }
}
walk(SRC)
if (on('plantorg')) files.set('src/components/planted/save.tsx', "'use client'\nexport async function save(supabase: any, org: string, v: any) {\n  await supabase.from('org_settings').upsert({ org_id: org, setting_key: 'x', setting_value: v })\n}\n")
if (on('plantteam')) files.set('src/lib/hooks/planted-team.ts', "export async function join(supabase: any, org: string, uid: string) {\n  const { error } = await supabase.from('team_profiles').insert({ org_id: org, user_id: uid, role: 'team_member', status: 'active' })\n  return error\n}\n")
if (on('clientimport')) files.set('src/components/planted/vault.tsx', "'use client'\nimport { readOrgSetting } from '@/lib/org-vault'\nexport const x = readOrgSetting\n")

/** The tables a source text writes, by scanning each from('<table>') chain up to the end of its statement. */
function writes(src) {
  const out = new Set()
  const re = /\.from\(\s*['"](org_settings|team_profiles)['"]\s*\)/g
  let m
  while ((m = re.exec(src))) {
    let tail = src.slice(m.index + m[0].length, m.index + m[0].length + 600)
    if (on('weak')) tail = tail.split('\n')[0]
    // the chain ends at a semicolon, the next from(), or a line that starts a new statement
    const end = tail.search(/;|\.from\(|\n\s*(const|let|var|return|await|if|for|}\s*$|export|function)\b/)
    const chain = end >= 0 ? tail.slice(0, end) : tail
    if (/\.\s*(insert|update|upsert|delete)\s*\(/.test(chain)) out.add(m[1])
  }
  return out
}

const isApi = (f) => f.startsWith('src/app/api/')
const isClient = (s) => /^\s*['"]use client['"]/.test(s)
const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

const offenders = { org_settings: [], team_profiles: [] }
for (const [f, s] of Array.from(files.entries())) {
  if (isApi(f)) continue
  for (const t of Array.from(writes(s))) {
    if (t === 'org_settings' && ALLOWED.has(f)) continue
    offenders[t].push(f)
  }
}
check('B_ORG', offenders.org_settings.length === 0, offenders.org_settings)
check('B_TEAM', offenders.team_profiles.length === 0, offenders.team_profiles)

// B_ALLOW: who imports each allowed module
{
  const bad = []
  for (const mod of Array.from(ALLOWED)) {
    const src = files.get(mod)
    if (!src) { bad.push(`${mod} missing`); continue }
    if (isClient(src)) bad.push(`${mod} is a client module`)
    const spec = mod.replace(/^src\//, '@/').replace(/\.tsx?$/, '')
    const base = path.posix.basename(spec)
    for (const [f, s] of Array.from(files.entries())) {
      if (f === mod) continue
      const imports = Array.from(s.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((x) => x[1])
      const hit = imports.some((i) => i === spec || (i.startsWith('.') && path.posix.join(path.posix.dirname(f), i).replace(/^src\//, '@/') === spec)
        || (i.endsWith(`/${base}`) && i.includes(path.posix.basename(path.posix.dirname(spec)))))
      if (!hit) continue
      if (isApi(f)) continue
      if (f.startsWith('src/lib/') && !isClient(s)) continue
      bad.push(`${f} imports ${mod}`)
    }
  }
  check('B_ALLOW', bad.length === 0, bad)
}

// B_DETECT: positive and negative controls for the scanner itself
{
  const yes = [
    ["supabase.from('org_settings').upsert({ a: 1 })", 'org_settings'],
    ["await db\n  .from('team_profiles')\n  .update({ role: 'admin' })\n  .eq('id', id)", 'team_profiles'],
    ['await sb.from("team_profiles").delete().eq("id", x)', 'team_profiles'],
    ["const { error } = await supabase\n  .from('org_settings')\n  .insert({ org_id })", 'org_settings'],
  ]
  const no = [
    "supabase.from('org_settings').select('setting_value').eq('org_id', o)",
    "const { data } = await supabase.from('team_profiles').select('*')\nconst r = await other.from('notes').update({ a: 1 })",
  ]
  const missed = yes.filter(([s, t]) => !writes(s).has(t)).map(([s]) => s.slice(0, 40))
  const falsePos = no.filter((s) => writes(s).size > 0).map((s) => s.slice(0, 40))
  check('B_DETECT', missed.length === 0 && falsePos.length === 0, { missed, falsePos })
}

H.report(rows, active, RED_OF)
