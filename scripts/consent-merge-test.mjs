// Proof harness for resolveConsent (src/lib/consent-merge.ts).
//
// Run: node scripts/consent-merge-test.mjs
//
// Deliberately dependency-free: it transpiles the single source file by stripping
// TS type syntax, so it tests THE REAL MODULE rather than a copy. If the source
// changes, this runs against the change. A test that asserts against a
// re-implementation proves nothing about the code that ships.
//
// Includes a TAMPER TEST: it perturbs the rule (AND -> OR) and confirms the suite
// FAILS. A harness that has only ever printed PASS is an unproven guard.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const SRC = 'src/lib/consent-merge.ts';
const TAMPER_FROM = 'sms_consent: bool(winner.sms_consent) && bool(loser.sms_consent),';
const TAMPER_TO   = 'sms_consent: bool(winner.sms_consent) || bool(loser.sms_consent),';

function loadModule({ tamper = false } = {}) {
  let code = readFileSync(SRC, 'utf8');
  if (tamper) {
    if (!code.includes(TAMPER_FROM)) {
      throw new Error('Tamper anchor not found in source — the harness is stale, fix it before trusting a PASS.');
    }
    code = code.replace(TAMPER_FROM, TAMPER_TO); // perturb exactly the operator the fix turns on
  }
  // Transpile with the real TS compiler rather than regex-stripping types, so the
  // harness tests THE SHIPPING MODULE and cannot drift from it.
  const { outputText } = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import('data:text/javascript;base64,' + Buffer.from(outputText).toString('base64'));
}

const checks = [];
const check = (name, pass, detail) => checks.push({ name, pass, detail });

async function run({ tamper = false } = {}) {
  checks.length = 0;
  const { resolveConsent } = await loadModule({ tamper });
  const NOW = '2026-07-25T00:00:00.000Z';

  // ── THE CASE THAT MOTIVATED THE FIX ────────────────────────────────────────
  // Survivor holds an unprovenanced true. Loser holds an EVIDENCED revoke.
  // Shaped after the real Melissa Allen pair (survivor 5c661e5c, loser 9af172f5).
  const winner = {
    id: 'THROWAWAY-WINNER',
    sms_consent: true,          // unprovenanced
    sms_consent_at: null,
    email_consent: true,        // unprovenanced
    email_consent_at: null,
    terms_accepted: false,
    terms_accepted_at: null,
    email_unsubscribed_at: null,
  };
  const loser = {
    id: 'THROWAWAY-LOSER',
    sms_consent: false,         // EVIDENCED REVOKE
    sms_consent_at: '2026-07-15T20:43:44.094Z',
    email_consent: false,
    email_consent_at: null,
    terms_accepted: true,
    terms_accepted_at: '2026-07-15T20:43:44.094Z',
    email_unsubscribed_at: null,
  };

  const { resolved, audit } = resolveConsent(winner, loser, NOW);

  check('evidenced SMS revoke survives the merge',
    resolved.sms_consent === false,
    `sms_consent = ${resolved.sms_consent} (expected false)`);

  check('revoke evidence carried forward, not dropped',
    resolved.sms_consent_at === '2026-07-15T20:43:44.094Z',
    `sms_consent_at = ${resolved.sms_consent_at}`);

  check('unprovenanced email true does not survive against a false',
    resolved.email_consent === false,
    `email_consent = ${resolved.email_consent}`);

  check('terms_accepted attestation is preserved (OR-ed)',
    resolved.terms_accepted === true && resolved.terms_accepted_at === '2026-07-15T20:43:44.094Z',
    `terms_accepted = ${resolved.terms_accepted} @ ${resolved.terms_accepted_at}`);

  check('audit names the rule',
    audit.rule === 'most_restrictive_wins',
    `rule = ${audit.rule}`);

  check('audit records BOTH inputs',
    audit.inputs.winner.sms_consent === true && audit.inputs.loser.sms_consent === false,
    JSON.stringify(audit.inputs));

  check('audit flags what changed from the winner',
    audit.changed_from_winner.includes('sms_consent') &&
    audit.changed_from_winner.includes('email_consent'),
    JSON.stringify(audit.changed_from_winner));

  // ── SYMMETRY: the reverse pair must resolve the same way ───────────────────
  const swapped = resolveConsent(loser, winner, NOW).resolved;
  check('most-restrictive is order-independent',
    swapped.sms_consent === false && swapped.email_consent === false,
    `sms=${swapped.sms_consent} email=${swapped.email_consent}`);

  // ── AN UNSUBSCRIBE IS NEVER DISCARDED ──────────────────────────────────────
  const unsub = resolveConsent(
    { email_consent: true, email_unsubscribed_at: null },
    { email_consent: true, email_unsubscribed_at: '2026-01-01T00:00:00.000Z' },
    NOW,
  ).resolved;
  check('unsubscribe timestamp survives even when both flags are true',
    unsub.email_unsubscribed_at === '2026-01-01T00:00:00.000Z',
    `email_unsubscribed_at = ${unsub.email_unsubscribed_at}`);

  // ── TRUE + TRUE STILL YIELDS TRUE (the fix must not be a blanket denial) ───
  const both = resolveConsent(
    { sms_consent: true, sms_consent_at: '2026-07-14T07:30:57.093Z' },
    { sms_consent: true, sms_consent_at: null },
    NOW,
  ).resolved;
  check('two genuine trues still resolve to true',
    both.sms_consent === true && both.sms_consent_at === '2026-07-14T07:30:57.093Z',
    `sms_consent = ${both.sms_consent} @ ${both.sms_consent_at}`);

  return { resolved, audit };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
const { resolved, audit } = await run();
const failed = checks.filter(c => !c.pass);

console.log('\n=== RESOLVED ROW (what the merge would write to the survivor) ===');
console.log(JSON.stringify(resolved, null, 2));
console.log('\n=== merge_details.consent_resolution ===');
console.log(JSON.stringify(audit, null, 2));

console.log('\n=== CHECKS ===');
for (const c of checks) console.log(`${c.pass ? 'PASS' : 'FAIL'}  ${c.name}\n        ${c.detail}`);

// ── TAMPER TEST ──────────────────────────────────────────────────────────────
console.log('\n=== TAMPER TEST (AND -> OR on sms_consent) ===');
await run({ tamper: true });
const tamperFailures = checks.filter(c => !c.pass);
const tamperCaught = tamperFailures.length > 0;
console.log(tamperCaught
  ? `Tampered rule CAUGHT by ${tamperFailures.length} check(s): ${tamperFailures.map(f => f.name).join('; ')}`
  : 'TAMPER NOT CAUGHT — this harness proves nothing.');

console.log('');
if (failed.length === 0 && tamperCaught) {
  console.log(`RESULT: PASS (${checks.length} checks, tamper test caught the perturbation)`);
  process.exit(0);
}
console.log(`RESULT: FAIL (${failed.length} failed, tamperCaught=${tamperCaught})`);
process.exit(1);
