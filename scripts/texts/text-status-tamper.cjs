#!/usr/bin/env node
// scripts/texts/text-status-tamper.cjs   (q43: Twilio text status callbacks move forward only)
//
// Runs the REAL src/lib/texts/status-callback.ts (what /api/twilio/message-status applies after its signature check)
// against an in-memory crm_messages table whose update honours the where clause (eq and in filters) and whose every
// call yields to the event loop once, so two callbacks started together interleave the way two requests do.
// Checks, from intent:
//   T_FORWARD          sent, then a late "queued" callback: the row stays sent, and the ignored callback is logged with
//                      the sid, the incoming and the current status
//   T_FAILED_FINAL     failed (error 30034), then a late "sending": stays failed and keeps 30034; a later "sent" carrying
//                      error 30008 still records 30008 while the status stays failed
//   T_DELIVERED_FINAL  delivered, then a late "sent" and a late "undelivered": stays delivered
//   T_RACE             a "delivered" and a "sending" callback for one queued text, arriving together, end delivered; the
//                      status update carries the allowed current statuses in its where clause (no read first)
//
//   backwards      sent may go back to queued                          {T_FORWARD}
//   failedback     failed may move again                               {T_FAILED_FINAL}
//   deliveredback  delivered may move to sent or failed                {T_DELIVERED_FINAL}
//   race           the rule is checked by reading the row first, then writing without a where clause   {T_RACE}
// TAMPER=1 reddens the sum (4).
const H = require('../agent/lib/harness.cjs')

const S = 'lib/texts/status-callback.ts'
const TAMPERS = {
  backwards: [[S, "  sent: ['sent', 'delivered', 'failed'],", "  sent: ['sent', 'delivered', 'failed', 'queued'],"]],
  failedback: [[S, "  failed: ['failed'],", "  failed: ['failed', 'queued', 'sent'],"]],
  deliveredback: [[S, "  delivered: ['delivered'],", "  delivered: ['delivered', 'sent', 'failed'],"]],
  race: [[S, "    const { data: moved, error } = await db.from('crm_messages').update({ ...identity, status: mapped }).eq('twilio_sid', sid).in('status', allowedFrom(mapped)).select('id')",
    "    const { data: cur } = await db.from('crm_messages').select('status').eq('twilio_sid', sid)\n    const okToMove = ((cur ?? []) as any[]).every((r) => allowedFrom(mapped).includes(r.status))\n    const { data: moved, error } = okToMove ? await db.from('crm_messages').update({ ...identity, status: mapped }).eq('twilio_sid', sid).select('id') : { data: [] as any[], error: null }"]],
}
const RED_OF = { backwards: ['T_FORWARD'], failedback: ['T_FAILED_FINAL'], deliveredback: ['T_DELIVERED_FINAL'], race: ['T_RACE'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-textstatus')
const load = H.install(out)
const cb = load(S)

function memDb(rows) {
  const T = { crm_messages: rows, job_runs: [] }
  const calls = []
  return {
    T, calls,
    from(table) {
      const ops = []
      const b = {}
      for (const m of ['select', 'eq', 'in', 'insert', 'update']) b[m] = (...a) => { ops.push([m, a]); return b }
      const exec = async () => {
        await new Promise((r) => setImmediate(r)) // one turn of the event loop per call: concurrent callbacks interleave
        calls.push({ table, ops })
        const ins = ops.find((o) => o[0] === 'insert'), upd = ops.find((o) => o[0] === 'update')
        if (ins) { T[table].push(ins[1][0]); return { data: [ins[1][0]], error: null } }
        let match = T[table].filter((r) => ops.every(([m, a]) => m === 'eq' ? r[a[0]] === a[1] : m === 'in' ? a[1].includes(r[a[0]]) : true))
        if (upd) for (const r of match) Object.assign(r, upd[1][0])
        match = match.map((r) => ({ ...r }))
        return { data: match, error: null }
      }
      b.then = (res, rej) => exec().then(res, rej)
      return b
    },
  }
}
const msg = (status, extra = {}) => ({ id: 'm1', twilio_sid: 'SM1', status, error_code: null, ...extra })
const call = (db, MessageStatus, extra = {}) => cb.applyStatusCallback(db, { MessageSid: 'SM1', MessageStatus, From: '+18285550000', To: '+18285550100', ...extra })

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  {
    const db = memDb([msg('sent')])
    const r = await call(db, 'queued')
    const log = db.T.job_runs.find((j) => j.job === 'text-status-ignored')
    check('T_FORWARD', db.T.crm_messages[0].status === 'sent' && r.updated === 0 && log && log.detail.sid === 'SM1' && log.detail.current === 'sent' && log.detail.incoming === 'queued',
      { status: db.T.crm_messages[0].status, log: log?.detail })
  }
  {
    const db = memDb([msg('failed', { error_code: '30034' })])
    await call(db, 'sending')
    const after1 = { ...db.T.crm_messages[0] }
    await call(db, 'sent', { ErrorCode: '30008' })
    const after2 = db.T.crm_messages[0]
    check('T_FAILED_FINAL', after1.status === 'failed' && after1.error_code === '30034' && after2.status === 'failed' && after2.error_code === '30008', { after1, after2 })
  }
  {
    const db = memDb([msg('delivered')])
    await call(db, 'sent')
    const a = db.T.crm_messages[0].status
    await call(db, 'undelivered', { ErrorCode: '30005' })
    check('T_DELIVERED_FINAL', a === 'delivered' && db.T.crm_messages[0].status === 'delivered', { afterSent: a, afterUndelivered: db.T.crm_messages[0].status })
  }
  {
    const db = memDb([msg('queued')])
    await Promise.all([call(db, 'delivered'), call(db, 'sending')])
    const statusUpdates = db.calls.filter((c) => c.table === 'crm_messages' && c.ops.some((o) => o[0] === 'update' && 'status' in o[1][0]))
    const guarded = statusUpdates.every((c) => c.ops.some((o) => o[0] === 'in' && o[1][0] === 'status'))
    const readFirst = db.calls.some((c, i) => c.table === 'crm_messages' && !c.ops.some((o) => o[0] === 'update') && i < db.calls.findIndex((x) => x.ops.some((o) => o[0] === 'update')))
    check('T_RACE', db.T.crm_messages[0].status === 'delivered' && statusUpdates.length > 0 && guarded && !readFirst, { status: db.T.crm_messages[0].status, guarded, readFirst })
  }
  H.report(rows, active, RED_OF)
})().catch((e) => { console.error(e); process.exit(2) })
