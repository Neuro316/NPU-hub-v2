#!/usr/bin/env node
// scripts/org-settings/credentials-tamper.cjs   (2026-11-08: org_settings credentials move to Vault)
//
//   V_PARITY   the credential field lists agree everywhere: VAULT_FIELDS (src/lib/org-vault-fields.ts) equals the
//              pairs hub_233 accepts and the pairs the data fix copies and blanks; credentialFields (Vault plus
//              slack_config.webhook_url) equals the pairs hub_232's write policy refuses
//   V_REDACT   redactCredentials blanks every credential field and reports which were set; carriesCredential and
//              withoutCredentials agree with it
//   V_ROUTES   GET /api/settings/read returns only redacted values; /api/slack/send never takes a webhook URL or a
//              bot token from the request; PUT /api/settings refuses a value carrying a credential
//   V_BROWSER  no client file selects org_settings (the browser reads through /api/settings/read only)
//
//   dropfield   a Vault field is dropped from the TypeScript list        {V_PARITY}
//   noredact    redactCredentials leaves the values in place            {V_REDACT}
//   rawread     the read route returns the unredacted value             {V_ROUTES}
//   bodyurl     slack/send posts to a webhook named in the request      {V_ROUTES}
// TAMPER=1 reddens the union (3). V_BROWSER reads the source tree as it is (a control).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/org-vault-fields.ts', READ = 'app/api/settings/read/route.ts', SLACK = 'app/api/slack/send/route.ts'
const TAMPERS = {
  dropfield: [[F, "crm_twilio: ['auth_token', 'api_key', 'api_secret'],", "crm_twilio: ['auth_token', 'api_key'],"]],
  noredact: [[F, "    if (f in out) out[f] = ''\n", '']],
  rawread: [[READ, 'const { value, set } = redactCredentials(k, await readOrgSetting(admin, orgId, k))',
    'const value = await readOrgSetting(admin, orgId, k); const set: Record<string, boolean> = {}; void redactCredentials']],
  bodyurl: [[SLACK, "const webhook = typeof config.webhook_url === 'string' ? config.webhook_url : ''",
    "const webhook = body?.webhook_url || (typeof config.webhook_url === 'string' ? config.webhook_url : '')"]],
}
const RED_OF = { dropfield: ['V_PARITY'], noredact: ['V_REDACT'], rawread: ['V_ROUTES'], bodyurl: ['V_ROUTES'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-orgcreds')
const load = H.install(out)
const fields = load(F)
const compiled = (rel) => fs.readFileSync(path.join(out, rel.replace(/\.tsx?$/, '.js')), 'utf8')
const raw = (rel) => fs.readFileSync(path.join(H.ROOT, rel), 'utf8')

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
const pairsOf = (sql) => Array.from(sql.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)'\)/g)).map((m) => `${m[1]}.${m[2]}`)
const uniq = (a) => Array.from(new Set(a)).sort()

// ── V_PARITY ──
{
  const vault = uniq(Object.entries(fields.VAULT_FIELDS).flatMap(([k, fs_]) => fs_.map((f) => `${k}.${f}`)))
  const creds = uniq(Object.keys({ ...fields.VAULT_FIELDS, ...fields.KEPT_FIELDS }).flatMap((k) => fields.credentialFields(k).map((f) => `${k}.${f}`)))
  const h233 = uniq(pairsOf(raw('supabase/migrations/hub_233_org_vault.sql').split('create function public.hub_org_vault_get')[0]))
  const h232 = uniq(pairsOf(raw('supabase/migrations/hub_232_org_settings_lockdown.sql').split('create function public.hub_org_settings_is_admin')[0]))
  const fix = raw('supabase/data-fixes/2026-11-08_org_credentials_to_vault.sql')
  const fixLists = fix.split(/\) as f\(k, field\)/).slice(0, -1).map((chunk) => uniq(pairsOf(chunk.slice(chunk.lastIndexOf('(values')))))
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  check('V_PARITY', vault.length === 16 && same(vault, h233) && same(creds, h232) && fixLists.length === 4 && fixLists.every((l) => same(l, vault)),
    { vault: vault.length, h233: h233.length, h232: h232.length, creds: creds.length, fix: fixLists.map((l) => l.length) })
}

// ── V_REDACT ──
{
  const v = { account_sid: 'AC1', auth_token: 'tok', numbers: [1] }
  const r = fields.redactCredentials('crm_twilio', v)
  const s = fields.redactCredentials('slack_config', { enabled: true, bot_token: 'x', webhook_url: 'https://h' })
  const ok = r.value.auth_token === '' && r.value.account_sid === 'AC1' && r.set.auth_token === true && r.set.api_key === false
    && s.value.bot_token === '' && s.value.webhook_url === '' && s.value.enabled === true
    && fields.carriesCredential('crm_ai', { anthropic_key: 'k' }) && !fields.carriesCredential('crm_ai', { anthropic_key: ' ', enabled: true })
    && !('bot_token' in fields.withoutCredentials('slack_config', { bot_token: 'x', channel: '#c' }))
    && fields.redactCredentials('branding', { logo_url: 'u' }).value.logo_url === 'u'
  check('V_REDACT', ok, { r, s })
}

// ── V_ROUTES ──
{
  const read = compiled(READ), slack = compiled(SLACK), put = compiled('app/api/settings/route.ts')
  const ok = /redactCredentials\)?\(k, await (\(0, [^)]*\.readOrgSetting\)|readOrgSetting)\(admin, orgId, k\)\)/.test(read.replace(/\s+/g, ' '))
    && !/body\??\.(webhook_url|bot_token)/.test(slack)
    && /carriesCredential\)?\(setting_key, setting_value\)/.test(put)
  check('V_ROUTES', ok, { read: read.includes('redactCredentials'), slackBody: /body\??\.(webhook_url|bot_token)/.test(slack) })
}

// ── V_BROWSER ── (source as it is)
{
  const bad = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name)) {
        const s = fs.readFileSync(p, 'utf8')
        if (!/^\s*['"]use client['"]/.test(s)) continue
        if (/from\(\s*['"]org_settings['"]\s*\)\s*\.select/.test(s.replace(/\s+/g, ' '))) bad.push(path.relative(H.ROOT, p))
      }
    }
  }
  walk(path.join(H.ROOT, 'src'))
  check('V_BROWSER', bad.length === 0, bad)
}

H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
