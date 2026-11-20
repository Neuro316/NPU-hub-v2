#!/usr/bin/env node
// scripts/mail/mail-token-tamper.cjs   (fix/mail-token-errors: a passing failure is not a dead mailbox)
//
// Runs the real src/lib/mail/google.ts (token endpoint and vault read), src/lib/mail/sync.ts and
// src/lib/mail/search.ts. Google's token endpoint is a fake fetch, the vault is a fake rpc, Gmail and triage are
// stubs. Checks, from intent:
//   T_VAULT      a vault read that errors or times out is vault_unavailable (transient): sync retries once, records
//                "vault_unavailable: ..." and leaves the status alone
//   T_TRANSIENT  Google 5xx, 429 or no answer is transient: sync retries once (a retry that works clears the run),
//                and a second failure records the code without marking the mailbox error
//   T_GRANT      invalid_grant, and a vault read that worked but holds no token (no_secret), DO mark it error, with
//                "invalid_grant: Google no longer accepts this sign-in"
//   T_SKIP       mail search tries a mailbox marked error and searches it when its sign-in works
//   T_REASON     mail search says "Reconnect" only for invalid_grant or no_secret; a transient failure says it will be
//                tried again
//   T_EMPTY      an empty or blank refresh token is never stored or used: storableRefreshToken refuses it, the callback
//                stores only what it returns, and the database function refuses an empty secret
//   T_RECHECK    a mailbox marked error is rechecked at most once a day by the mail-sync cron (src/lib/mail/recheck.ts):
//                a failed recheck keeps the error and records the code, a second run the same day does not check
//                again, and a recheck a day later that passes clears the error; no token is ever written
//
//   vaultblip        a vault read error becomes no_secret again                 {T_VAULT}
//   transientbroken  Google 5xx and 429 are read as invalid_grant              {T_TRANSIENT}
//   grantignored     sync marks only no_secret, not invalid_grant, as error    {T_GRANT}
//   skiperror        search skips a mailbox in error without trying it         {T_SKIP}
//   wrongreason      every token failure tells the user to reconnect          {T_REASON}
//   emptytoken       an empty refresh token passes as storable                 {T_EMPTY}
//   recheck_once_per_day  the day's earlier recheck is ignored                 {T_RECHECK}
// TAMPER=1 reddens the sum (7).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const G = 'lib/mail/google.ts', SY = 'lib/mail/sync.ts', SE = 'lib/mail/search.ts', RC = 'lib/mail/recheck.ts'
const TAMPERS = {
  vaultblip: [[G, "  if (res.error) throw new MailError('The stored sign-in could not be read just now. It will be tried again.', 'vault_unavailable')",
    "  if (res.error) throw new MailError('The stored credential for this mailbox is missing. Reconnect it.', 'no_secret')"]],
  transientbroken: [[G, `    throw new MailError("Google's sign-in service did not answer. It will be tried again.", 'google_unavailable')`,
    "    throw new MailError('Google no longer accepts this connection. Disconnect and connect again.', 'invalid_grant')"]],
  grantignored: [[SY, "...(isPermanent(c) ? { status: 'error' } : {})", "...(c === 'no_secret' ? { status: 'error' } : {})"]],
  skiperror: [[SE, "    if (r.status === 'revoked') { skip(r, REASON.revoked); continue }\n", "    if (r.status === 'revoked') { skip(r, REASON.revoked); continue }\n    if (r.status !== 'active') { skip(r, REASON.later); continue }\n"]],
  wrongreason: [[SE, 'const reasonFor = (e: unknown) => (e instanceof MailError && isPermanent(e.code) ? REASON.reconnect : REASON.later)',
    'const reasonFor = (e: unknown) => (e instanceof MailError ? REASON.reconnect : REASON.later)']],
  emptytoken: [[G, '  const t = v.trim()\n  return t.length > 0 ? t : null', '  return v']],
  recheck_once_per_day: [[RC, '    if (done.has(row.id)) continue\n', '']],
}
const RED_OF = { vaultblip: ['T_VAULT'], transientbroken: ['T_TRANSIENT'], grantignored: ['T_GRANT'], skiperror: ['T_SKIP'], wrongreason: ['T_REASON'], emptytoken: ['T_EMPTY'], recheck_once_per_day: ['T_RECHECK'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-mailtoken')

process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret'

// Google's token endpoint: each call takes the next planned answer
let plan = []
let tokenCalls = 0
global.fetch = async (url) => {
  if (!String(url).startsWith('https://oauth2.googleapis.com/token')) throw new Error('unexpected network call')
  tokenCalls++
  const step = plan.shift() ?? 'ok'
  if (step === 'network') throw new Error('socket hang up')
  const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
  if (step === 'ok') return reply(200, { access_token: 'access-token' })
  if (step === '503') return reply(503, {})
  if (step === '429') return reply(429, {})
  if (step === 'invalid_grant') return reply(400, { error: 'invalid_grant' })
  throw new Error(`bad plan step ${step}`)
}

const load = H.install(out, {
  '@/lib/mail/gmail': {
    currentHistoryId: async () => '9', inboxAddedSince: async () => ({ added: [], historyId: '9' }),
    sentAddedSince: async () => ({ added: [], historyId: '9' }), getSentMetadata: async () => ({ recipients: [], sentAt: null }),
    getMessageForTriage: async () => { throw new Error('no triage expected') },
    searchMessageIds: async () => [], getMessageMeta: async () => { throw new Error('none') }, getThreadFull: async () => [],
  },
  '@/lib/mail/triage': { classifyEmail: async () => { throw new Error('no triage expected') } },
})
const google = load(G), sync = load(SY), search = load(SE), recheck = load(RC)

/** A database for one sync run: the vault answers from `vault` (one entry per read), writes are recorded. */
function syncDb(vault) {
  const writes = []
  let vaultReads = 0
  const db = H.stubDb({}, {
    rpc: (name) => {
      if (name !== 'hub_mail_token_get') return undefined
      vaultReads++
      const v = vault.shift() ?? 'ok'
      if (v === 'throw') throw new Error('vault down')
      if (v === 'error') return { data: null, error: { code: '57014' } }
      if (v === 'empty') return { data: null, error: null }
      if (v === 'blank') return { data: '', error: null }
      return { data: 'refresh-token', error: null }
    },
    table: (table, ops, mode) => {
      const w = ops.find((o) => ['update', 'upsert', 'insert'].includes(o[0]))
      if (w) { writes.push({ table, payload: w[1][0] }); return { data: null, error: null } }
      if (table === 'hub_mail_connections') {
        const sel = ops.find((o) => o[0] === 'select')
        if (sel && /gmail_sent_history_id/.test(sel[1][0])) return { data: { gmail_sent_history_id: '9' }, error: null }
        return { data: [{ id: 'c1', gmail_history_id: '9' }], error: null }
      }
      if (table === 'hub_mail_messages') {
        const sel = ops.find((o) => o[0] === 'select')
        if (sel && sel[1][1] && sel[1][1].head) return { data: null, count: 0, error: null }
        return { data: [], error: null }
      }
      return { data: mode === 'maybeSingle' ? null : [], error: null }
    },
  })
  return { db, writes, reads: () => vaultReads }
}
async function runSync(vault, tokenPlan) {
  plan = tokenPlan.slice(); tokenCalls = 0
  const s = syncDb(vault.slice())
  const results = await sync.runMailSync(s.db, Date.now() + 30_000, 0)
  const connWrites = s.writes.filter((w) => w.table === 'hub_mail_connections').map((w) => w.payload)
  const errWrite = connWrites.find((p) => 'last_error' in p) ?? null
  return { result: results[0], errWrite, markedError: connWrites.some((p) => p.status === 'error'), vaultReads: s.reads(), tokenCalls }
}
const codeOf = async (fn) => { try { await fn(); return 'none' } catch (e) { return e.code ?? 'plain' } }

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

;(async () => {
  // T_VAULT
  {
    const direct = await codeOf(() => google.refreshTokenFor(syncDb(['error']).db, 'c1'))
    const thrown = await codeOf(() => google.refreshTokenFor(syncDb(['throw']).db, 'c1'))
    const twice = await runSync(['error', 'error'], [])
    const healed = await runSync(['error', 'ok'], ['ok'])
    check('T_VAULT', direct === 'vault_unavailable' && thrown === 'vault_unavailable' && !twice.markedError && twice.vaultReads === 2
      && /^vault_unavailable: could not read the stored sign-in, will retry$/.test(twice.errWrite?.last_error ?? '') && !healed.errWrite && !healed.result.error,
      { direct, thrown, twice: { marked: twice.markedError, reads: twice.vaultReads, last_error: twice.errWrite?.last_error }, healed: healed.result.error })
  }

  // T_TRANSIENT
  {
    const fiveHundred = await runSync([], ['503', '503'])
    const rateThenOk = await runSync([], ['429', 'ok'])
    const net = await runSync([], ['network', 'network'])
    check('T_TRANSIENT', !fiveHundred.markedError && /^google_unavailable: /.test(fiveHundred.errWrite?.last_error ?? '') && fiveHundred.tokenCalls === 2
      && !rateThenOk.errWrite && !rateThenOk.result.error && rateThenOk.tokenCalls === 2
      && !net.markedError && /^network: /.test(net.errWrite?.last_error ?? ''),
      { fiveHundred: [fiveHundred.markedError, fiveHundred.errWrite?.last_error], rateThenOk: rateThenOk.result.error, net: [net.markedError, net.errWrite?.last_error] })
  }

  // T_GRANT
  {
    const grant = await runSync([], ['invalid_grant'])
    const missing = await runSync(['empty'], [])
    check('T_GRANT', grant.markedError && grant.errWrite?.last_error === 'invalid_grant: Google no longer accepts this sign-in' && grant.tokenCalls === 1
      && missing.markedError && /^no_secret: /.test(missing.errWrite?.last_error ?? '') && missing.vaultReads === 1,
      { grant: [grant.markedError, grant.errWrite?.last_error], missing: [missing.markedError, missing.errWrite?.last_error] })
  }

  // T_SKIP and T_REASON: mail search with its Gmail and token calls passed in
  const ME = '00000000-0000-4000-8000-00000000000a', ORG = '00000000-0000-0000-0000-000000000001'
  const conn = (id, status) => ({ id, org_id: ORG, owner_user_id: ME, email_address: `${id}@example.com`, visibility: 'private', status, scopes: [], connected_at: '', last_checked_at: null, last_error: null })
  const conns = [conn('m-err', 'error'), conn('m-net', 'active'), conn('m-vault', 'active'), conn('m-grant', 'active'), conn('m-missing', 'active'), conn('m-rev', 'revoked')]
  const caller = { userId: ME, orgIds: [ORG], orgRoles: { [ORG]: 'super_admin' }, isSuperadmin: true, via: 'session', db: H.stubDb({ hub_mail_connections: conns }) }
  const tried = []
  const fail = { 'm-net': 'network', 'm-vault': 'vault_unavailable', 'm-grant': 'invalid_grant', 'm-missing': 'no_secret' }
  const io = {
    refreshTokenFor: async (_db, id) => { tried.push(id); if (fail[id]) throw new google.MailError('x', fail[id]); return `rt-${id}` },
    accessTokenFor: async (rt) => `at-${rt}`,
    searchMessageIds: async () => [], getMessageMeta: async () => { throw new Error('none') }, getThreadFull: async () => [],
  }
  const input = { emails: ['a@example.org'], phones: [], names: [], dateFrom: '2025-11-18', dateTo: '2026-11-19', threadId: null, mailbox: null }
  const r = await search.runSearch(caller, input, io)
  const reason = Object.fromEntries(r.not_searched.map((n) => [n.connection_id, n.reason]))

  check('T_SKIP', tried.includes('m-err') && r.mailboxes_searched.includes('m-err@example.com') && !reason['m-err'] && !tried.includes('m-rev') && reason['m-rev'] === search.REASON.revoked,
    { tried, searched: r.mailboxes_searched })
  check('T_REASON', reason['m-net'] === 'Could not be read just now; it will be tried again.' && reason['m-vault'] === search.REASON.later
    && reason['m-grant'] === 'Google no longer accepts this sign-in. Reconnect it in Settings, Mailboxes.' && reason['m-missing'] === search.REASON.reconnect,
    { reason })

  // T_EMPTY
  {
    const s = google.storableRefreshToken
    const pure = [s('') === null, s('   ') === null, s(undefined) === null, s(null) === null, s(' real-token ') === 'real-token']
    const blank = await codeOf(() => google.refreshTokenFor(syncDb(['blank']).db, 'c1'))
    const cb = fs.readFileSync(path.join(H.SRC, 'app/api/mail/callback/route.ts'), 'utf8')
    const wired = /const refreshToken = storableRefreshToken\(grant\.refreshToken\)/.test(cb) && /if \(!refreshToken\)/.test(cb) && /p_secret: refreshToken,/.test(cb)
    const sql = fs.readFileSync(path.join(H.ROOT, 'supabase/migrations/hub_216_mail_connections.sql'), 'utf8')
    const dbRefuses = /if p_secret is null or length\(p_secret\) = 0 then\s+raise exception 'mailbox_secret_missing'/.test(sql)
    check('T_EMPTY', pure.every(Boolean) && blank === 'no_secret' && wired && dbRefuses, { pure, blank, wired, dbRefuses })
  }

  // T_RECHECK
  {
    const T = { hub_mail_connections: [{ id: 'mbx1', email_address: 'box@neuroprogeny.com', status: 'error', last_error: 'invalid_grant: old' }], job_runs: [] }
    const writes = []
    const cmp = (a, b) => Date.parse(a) - Date.parse(b)
    const db = {
      rpc: async (name) => { writes.push(`rpc:${name}`); return { data: null, error: null } },
      from(table) {
        const ops = []
        const b = {}
        for (const m of ['select', 'eq', 'gte', 'insert', 'update']) b[m] = (...a) => { ops.push([m, a]); return b }
        const exec = (one) => {
          const filt = (rows) => ops.reduce((r, [m, a]) => m === 'eq' ? r.filter((x) => x[a[0]] === a[1]) : m === 'gte' ? r.filter((x) => x[a[0]] && cmp(x[a[0]], a[1]) >= 0) : r, rows)
          const ins = ops.find((o) => o[0] === 'insert'), upd = ops.find((o) => o[0] === 'update')
          if (ins) { const row = { id: `jr${T.job_runs.length + 1}`, ...ins[1][0] }; T[table].push(row); writes.push(`${table}:insert`); return { data: one ? row : [row], error: null } }
          if (upd) { const r = filt(T[table]); r.forEach((x) => Object.assign(x, upd[1][0])); writes.push(`${table}:update:${Object.keys(upd[1][0]).join(',')}`); return { data: r, error: null } }
          return { data: filt(T[table].slice()), error: null }
        }
        b.single = () => ({ then: (res, rej) => Promise.resolve(exec(true)).then(res, rej) })
        b.then = (res, rej) => Promise.resolve(exec(false)).then(res, rej)
        return b
      },
    }
    const t0 = Date.parse('2026-11-20T15:00:00Z')
    let checks = 0
    const failing = async () => { checks++; throw new google.MailError('Google no longer accepts this sign-in.', 'invalid_grant') }
    const passing = async () => { checks++ }
    const r1 = await recheck.recheckErrored(db, t0, failing)
    const box = T.hub_mail_connections[0]
    const afterFail = { status: box.status, err: box.last_error }
    const r2 = await recheck.recheckErrored(db, t0 + 3_600_000, failing)
    const checksSameDay = checks
    const r3 = await recheck.recheckErrored(db, t0 + 25 * 3_600_000, passing)
    const tokenWrites = writes.filter((w) => /token|secret|vault/i.test(w))
    check('T_RECHECK', r1.length === 1 && r1[0].code === 'invalid_grant' && afterFail.status === 'error' && /^invalid_grant/.test(afterFail.err)
      && r2.length === 0 && checksSameDay === 1 && r3.length === 1 && r3[0].ok && box.status === 'active' && box.last_error === null && tokenWrites.length === 0,
    { r1, r2, checksSameDay, r3, box, tokenWrites })
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
