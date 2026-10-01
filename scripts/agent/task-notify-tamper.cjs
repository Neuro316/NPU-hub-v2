#!/usr/bin/env node
// scripts/agent/task-notify-tamper.cjs   (Stage 0 answer 2, AG21: creating the Client Task copy
// notifies nobody but the assignee)
//
// The database half is contract-213.sql T_NO_NOTIFY (no kanban_tasks, contact_timeline or
// hub_sms_outbox row appears when agent_build writes the copy). This is the code half: walk the
// TRANSITIVE import graph from the agent's entry points and assert no notifier module is
// reachable, so nothing in the agent's code path can send a message, an SMS or a Slack post.
//   N_CLOSURE    no notifier module is in the agent's import closure
//   N_TASK_SQL   the only task write is public.agent_build (an rpc), with no direct tasks insert
//   C_FINDS      control: the same walk from a route that does notify finds its notifier
//
//   importsms   the agent route imports the SMS notifier          {N_CLOSURE}
//   deep        a module the agent imports pulls in Slack          {N_CLOSURE}  (disjoint file, same case)
//   directtask  the agent writes tasks itself                      {N_TASK_SQL}
// TAMPER=1 reddens the union (2). importsms and deep both redden N_CLOSURE; the sum rule is
// checked per case, so TAMPER=1 must equal {N_CLOSURE, N_TASK_SQL}.
const fs = require('fs'), path = require('path')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')
const ENTRIES = ['app/api/marketing/agent/route.ts']
const NOTIFIERS = ['lib/notify-sms', 'lib/sms-outbox', 'lib/slack-notifications', 'lib/twilio', 'lib/twilio-org',
  'lib/marketing/providers/resend', 'lib/marketing/providers/twilio-sms']
const PLANT = {
  importsms: { file: 'app/api/marketing/agent/route.ts', add: "import { notifySms } from '@/lib/notify-sms'\n" },
  deep: { file: 'lib/agent/settle.ts', add: "import { sendSlack } from '@/lib/slack-notifications'\n" },
  directtask: { file: 'lib/agent/review.ts', add: "export const x = (db: any) => db.from('tasks').insert({ title: 't' })\n" },
}
const RED_OF = { importsms: ['N_CLOSURE'], deep: ['N_CLOSURE'], directtask: ['N_TASK_SQL'] }
const sel = process.env.TAMPER || ''
const active = sel === '1' ? Object.keys(PLANT) : sel ? sel.split(',') : []
for (const t of active) if (!PLANT[t]) { console.error(`unknown selector ${t}`); process.exit(2) }

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const read = (rel) => {
  let s = fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
  for (const t of active) if (PLANT[t].file === rel) s = PLANT[t].add + s
  return s
}
const resolve = (from, spec) => {
  let base
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))
  else return null
  for (const ext of ['.ts', '.tsx', '/index.ts']) if (fs.existsSync(path.join(SRC, base + ext))) return base + ext
  return null
}
function closure(entries) {
  const seen = new Set(), stack = [...entries]
  while (stack.length) {
    const f = stack.pop()
    if (seen.has(f)) continue
    seen.add(f)
    // type-only imports carry no code, so they cannot notify anyone
    for (const m of strip(read(f)).matchAll(/import\s+(type\s+)?[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
      if (m[1]) continue
      const r = resolve(f, m[2]); if (r) stack.push(r)
    }
  }
  return seen
}
const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

const reach = closure(ENTRIES)
const hit = [...reach].filter((f) => NOTIFIERS.some((n) => f.startsWith(n + '.')))
check('N_CLOSURE', reach.size > 5 && hit.length === 0, { modules: reach.size, notifiers: hit })
const taskWrites = [...reach].filter((f) => /from\(\s*['"]tasks['"]\s*\)/.test(strip(read(f))))
const usesBuild = [...reach].some((f) => /rpc\(\s*['"]agent_build['"]/.test(strip(read(f))))
check('N_TASK_SQL', taskWrites.length === 0 && usesBuild, { taskWrites, usesBuild })
// control: the same walk, from a route known to send SMS, must find a notifier
const ctl = [...closure(['app/api/cron/sms-outbox/route.ts'])].filter((f) => NOTIFIERS.some((n) => f.startsWith(n + '.')))
check('C_FINDS', ctl.length > 0, ctl)

const red = rows.filter((r) => !r.ok).map((r) => r.id).sort()
for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'RED '} ${r.id}${r.ok ? '' : `  got ${JSON.stringify(r.got)}`}`)
if (!active.length) { console.log(red.length ? `FAIL: ${red.length} red` : `PASS: ${rows.length} of ${rows.length}`); process.exit(red.length ? 1 : 0) }
const want = Array.from(new Set(active.flatMap((t) => RED_OF[t]))).sort()
console.log(`red {${red.join(',')}}, declared {${want.join(',')}}`)
if (!red.length) { console.error('FATAL: a TAMPERED run PASSED.'); process.exit(3) }
if (JSON.stringify(red) !== JSON.stringify(want)) { console.error('FATAL: tampered red SET does not match the declaration.'); process.exit(3) }
process.exit(0)
