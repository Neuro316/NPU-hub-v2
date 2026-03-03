// fix-proportional.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

console.log('=== Fix: Pre-Aug proportional clinic distribution ===\n');

// Replace the pre-Aug branch that does waterfall (min of flat, pool)
// with proportional (flat/serviceTotal * payment)
const oldPreAug = `if (isPreAug) {
        // ══════ PRE-AUGUST 2025: LEGACY 10% ERA ══════
        // SNW only received 10% of gross. Clinic = flat waterfall.
        // Dr. Yonce (JoJo) received everything else.
        const snwTotal = r2(amt * PRE_AUG_SNW_PCT / 100)
        const poolAfterSNW = r2(amt - snwTotal)
        const clinicFee = r2(Math.min(cl.flat_clinic, Math.max(poolAfterSNW, 0)))
        let drFee = r2(poolAfterSNW - clinicFee)
        const drift = r2(amt - snwTotal - clinicFee - drFee)
        drFee = r2(drFee + drift)
        return {
          snw: Math.max(snwTotal, 0),
          dr: Math.max(drFee, 0),
          cc: ccAmt,
          snwService: r2(Math.max(snwTotal - ccAmt, 0)),
          clinicAmts: { [cl.id]: Math.max(clinicFee, 0) } as Record<string, number>,
        }
      }`;

const newPreAug = `if (isPreAug) {
        // ══════ PRE-AUGUST 2025: LEGACY 10% ERA ══════
        // SNW received only 10% of gross (not 26%).
        // Clinic flat target ($3995) distributed PROPORTIONALLY
        // across payments based on program total, NOT per-payment waterfall.
        // This ensures clinic is capped at flat_clinic total across all payments
        // and Dr. Yonce receives remainder on every payment.
        const snwTotal = r2(amt * PRE_AUG_SNW_PCT / 100)
        const svcPortion = r2(Math.max(snwTotal - ccAmt, 0))

        if ((serviceTotal || 0) > 0) {
          const clinicGrossPct = (cl.flat_clinic || 0) / (serviceTotal || 1)
          let clinicAmt = r2(amt * clinicGrossPct)
          // Safety: clinic cannot exceed post-SNW pool
          clinicAmt = r2(Math.min(clinicAmt, Math.max(amt - snwTotal, 0)))
          let drAmt = r2(amt - snwTotal - clinicAmt)
          const drift = r2(amt - snwTotal - clinicAmt - drAmt)
          if (Math.abs(drift) >= 0.01) drAmt = r2(drAmt + drift)
          drAmt = Math.max(drAmt, 0)
          return {
            snw: Math.max(snwTotal, 0),
            dr: drAmt,
            cc: ccAmt,
            snwService: Math.max(svcPortion, 0),
            clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
          }
        }

        // Fallback if no serviceTotal
        const poolAfterSNW = r2(amt - snwTotal)
        const clinicFee = r2(Math.min(cl.flat_clinic, Math.max(poolAfterSNW, 0)))
        let drFee = r2(poolAfterSNW - clinicFee)
        const drift = r2(amt - snwTotal - clinicFee - drFee)
        drFee = r2(drFee + drift)
        return {
          snw: Math.max(snwTotal, 0),
          dr: Math.max(drFee, 0),
          cc: ccAmt,
          snwService: Math.max(svcPortion, 0),
          clinicAmts: { [cl.id]: Math.max(clinicFee, 0) } as Record<string, number>,
        }
      }`;

if (code.includes(oldPreAug)) {
  code = code.replace(oldPreAug, newPreAug);
  console.log('  \u2713 Replaced pre-Aug waterfall with proportional');
} else {
  console.log('  \u2717 Could not find pre-Aug block');
  // Try to find what's there
  const idx = code.indexOf('PRE-AUGUST 2025');
  if (idx >= 0) {
    console.log('  Found PRE-AUGUST at char ' + idx);
    console.log('  Context: ' + code.substring(idx, idx + 200));
  }
}

writeFileSync(FILE, code, 'utf-8');

// Verify with a test calculation
console.log('\n--- Test: $500 payment on $5400 program, pre-Aug, flat_clinic=$3995 ---');
const pmt = 500, prog = 5400, flat = 3995, snwPct = 10;
const snw = Math.round(pmt * snwPct) / 100;
const clinicPct = flat / prog;
const clinic = Math.round(pmt * clinicPct * 100) / 100;
const dr = Math.round((pmt - snw - clinic) * 100) / 100;
console.log('  SNW (10%):  $' + snw);
console.log('  Clinic:     $' + clinic + ' (' + Math.round(clinicPct * 10000) / 100 + '% = ' + flat + '/' + prog + ')');
console.log('  Dr. Yonce:  $' + dr);
console.log('  Sum check:  $' + (snw + clinic + dr));
console.log('  After full $5400 collected:');
console.log('    SNW total:    $' + (5400 * 0.10));
console.log('    Clinic total: $' + Math.round(5400 * clinicPct * 100) / 100 + ' (capped at $' + flat + ')');
console.log('    Dr total:     $' + Math.round((5400 - 540 - 3995) * 100) / 100);
