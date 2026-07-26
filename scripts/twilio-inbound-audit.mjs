// READ-ONLY Twilio audit. Enumerates every message to/from the Hub's numbers so
// inbound can be reconciled against crm_messages. Never sends, never replies,
// never mutates Twilio state. Credentials come from .env.local and are never printed.
//
// Run: node scripts/twilio-inbound-audit.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

// Credentials from the shell first, .env.local second. Deliberately NOT from the
// database: fetching the auth token through a tool call would print a production
// credential into a chat transcript.
//   TWILIO_ACCOUNT_SID=ACxxx TWILIO_AUTH_TOKEN=xxx node scripts/twilio-inbound-audit.mjs
const fileEnv = existsSync('.env.local')
  ? Object.fromEntries(
      readFileSync('.env.local', 'utf8')
        .split('\n')
        .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
        .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; })
    )
  : {};

const SID = process.env.TWILIO_ACCOUNT_SID || fileEnv.TWILIO_ACCOUNT_SID;
const TOKEN = process.env.TWILIO_AUTH_TOKEN || fileEnv.TWILIO_AUTH_TOKEN;
if (!SID || !TOKEN || SID === '[SENSITIVE]' || TOKEN === '[SENSITIVE]') {
  console.error('Missing or redacted Twilio credentials.\n' +
    'Run:  TWILIO_ACCOUNT_SID=AC… TWILIO_AUTH_TOKEN=… node scripts/twilio-inbound-audit.mjs\n' +
    'The account that owns +18289009821 is the one in CRM Settings > Twilio (starts AC96fe7ac…).');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from(`${SID}:${TOKEN}`).toString('base64');

const NUMBERS = ['+18289009821', '+18284155050'];

async function page(url) {
  const r = await fetch(url, { headers: { Authorization: AUTH } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} :: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function listAll(params) {
  const out = [];
  let url = `https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json?PageSize=1000&${params}`;
  while (url) {
    const j = await page(url);
    out.push(...(j.messages || []));
    url = j.next_page_uri ? `https://api.twilio.com${j.next_page_uri}` : null;
  }
  return out;
}

const all = [];
for (const n of NUMBERS) {
  const to = await listAll(`To=${encodeURIComponent(n)}`);
  const from = await listAll(`From=${encodeURIComponent(n)}`);
  console.log(`${n}  inbound(To=)=${to.length}  outbound(From=)=${from.length}`);
  all.push(...to.map(m => ({ ...m, _hubNumber: n, _dir: 'to_hub' })));
  all.push(...from.map(m => ({ ...m, _hubNumber: n, _dir: 'from_hub' })));
}

// de-dupe by sid (a hub-to-hub message would appear twice)
const bySid = new Map(all.map(m => [m.sid, m]));
const msgs = [...bySid.values()].sort((a, b) => new Date(a.date_sent) - new Date(b.date_sent));

writeFileSync('scripts/.twilio-audit.json', JSON.stringify(msgs, null, 2));

console.log(`\nTOTAL distinct messages: ${msgs.length}\n`);
console.log('sid                                 | hub_number   | dir      | direction        | from          | to            | date_sent (UTC)      | status     | body');
for (const m of msgs) {
  const body = String(m.body || '').replace(/\s+/g, ' ').slice(0, 60);
  console.log([
    m.sid, m._hubNumber.padEnd(12), m._dir.padEnd(8),
    String(m.direction).padEnd(16), String(m.from).padEnd(13), String(m.to).padEnd(13),
    String(m.date_sent).padEnd(20), String(m.status).padEnd(10), body,
  ].join(' | '));
}

// SIDs for the SQL comparison
console.log('\n--- INBOUND SIDs (direction=inbound) ---');
console.log(msgs.filter(m => m.direction === 'inbound').map(m => `'${m.sid}'`).join(',') || '(none)');
