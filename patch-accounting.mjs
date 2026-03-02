// patch-accounting.mjs
// Run: node patch-accounting.mjs
// From: C:\Users\Camer\Downloads\npu-hub-fresh

import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
let patches = 0;

function patch(label, old, replacement) {
  if (code.includes(old)) {
    code = code.replace(old, replacement);
    patches++;
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ SKIP: ${label} (pattern not found)`);
  }
}

console.log('=== Patching Accounting Logic ===\n');

// ══════════════════════════════════════════════════
// PATCH 1: Replace calcSplit function
// ══════════════════════════════════════════════════
console.log('[1] Replacing calcSplit...');

patch('calcSplit function',
`function calcSplit(amt: number, svcType: string, locId: string, locs: AcctLocation[], clinics: AcctClinic[], cfg: AcctConfig) {
  if (amt <= 0) return { snw: 0, dr: 0, cc: 0, snwService: 0, clinicAmts: {} as Record<string, number> }
  const ccPct = cfg.cc_processing_fee ?? 3

  // ── MAP (qEEG): percentage split, SNW + Dr.Y only ──
  if (svcType === 'Map') {
    const ms = cfg.map_splits
    const snwAmt = r2(amt * ms.snw / 100)
    const drAmt = r2(amt - snwAmt)
    return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: 0, snwService: 0, clinicAmts: {} as Record<string, number> }
  }

  // ── PROGRAM: waterfall ──
  const loc = locs.find(l => l.id === locId)
  const cl = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null

  if (cl) {
    const useWaterfall = (cl.flat_clinic || 0) > 0

    if (useWaterfall) {
      // ══════ WATERFALL MODE ══════
      // Step 1: SNW gets split_snw% of gross (e.g. 26%). This INCLUDES CC fee.
      const snwTotal = r2(amt * cl.split_snw / 100)
      // Internal breakdown: CC portion vs services portion (for reporting only)
      const ccPortion = r2(amt * ccPct / 100)
      const svcPortion = r2(snwTotal - ccPortion)
      // Step 2: Pool after SNW
      const poolAfterSNW = r2(amt - snwTotal)
      // Step 3: Clinic flat fee from remaining pool
      const clinicFee = r2(Math.min(cl.flat_clinic, Math.max(poolAfterSNW, 0)))
      // Step 4: Dr. Yonce = everything left
      let drFee = r2(poolAfterSNW - clinicFee)
      // Rounding guardrail: ensure sum == P
      const drift = r2(amt - snwTotal - clinicFee - drFee)
      drFee = r2(drFee + drift)

      return {
        snw: Math.max(snwTotal, 0),
        dr: Math.max(drFee, 0),
        cc: Math.max(ccPortion, 0),
        snwService: Math.max(svcPortion, 0),
        clinicAmts: { [cl.id]: Math.max(clinicFee, 0) } as Record<string, number>,
      }
    } else {
      // ══════ PERCENTAGE MODE (traditional 3-way) ══════
      // SNW% includes CC internally
      const snwAmt = r2(amt * cl.split_snw / 100)
      const clinicAmt = r2(amt * cl.split_clinic / 100)
      let drAmt = r2(amt - snwAmt - clinicAmt)
      const drift = r2(amt - snwAmt - clinicAmt - drAmt)
      drAmt = r2(drAmt + drift)
      const ccPortion = r2(amt * ccPct / 100)
      return {
        snw: Math.max(snwAmt, 0),
        dr: Math.max(drAmt, 0),
        cc: Math.max(ccPortion, 0),
        snwService: r2(snwAmt - ccPortion),
        clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
      }
    }
  }

  // No clinic assigned fallback
  const snwAmt = r2(amt * 81.01 / 100)
  const drAmt = r2(amt - snwAmt)
  return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: 0, snwService: snwAmt, clinicAmts: {} as Record<string, number> }
}`,

`// ══════════════════════════════════════════════════════════════
// SENSORIUM ACCOUNTING AGREEMENT
// ──────────────────────────────────────────────────────────────
// Pre-Aug 1 2025: SNW received only 10% of gross Program fee.
//   Clinic received flat fee via waterfall. Dr. Yonce got rest.
// Post-Aug 1 2025: SNW receives split_snw% (26%) of gross.
//   Clinic flat target distributed proportionally across payments
//   based on agreed program total (acct_services.amount).
//   SNW collects at higher proportion until full fee satisfied.
// ALL CC processing fees go to Sensorium always.
// Clinics submit biweekly invoices with session totals by client.
// Sensorium pays out on all sessions performed per invoice.
// ══════════════════════════════════════════════════════════════
const PRE_AUG_CUTOFF = '2025-08-01'
const PRE_AUG_SNW_PCT = 10

function calcSplit(
  amt: number,
  svcType: string,
  locId: string,
  locs: AcctLocation[],
  clinics: AcctClinic[],
  cfg: AcctConfig,
  serviceTotal?: number,
  paymentDate?: string,
) {
  if (amt <= 0) return { snw: 0, dr: 0, cc: 0, snwService: 0, clinicAmts: {} as Record<string, number> }
  const ccPct = cfg.cc_processing_fee ?? 3
  const ccAmt = r2(amt * ccPct / 100) // CC always goes to Sensorium

  const isPreAug = paymentDate ? paymentDate < PRE_AUG_CUTOFF : false

  // ── MAP (qEEG): SNW + Dr only, clinic = $0 always ──
  if (svcType === 'Map') {
    const ms = cfg.map_splits
    const snwAmt = r2(amt * ms.snw / 100)
    const drAmt = r2(amt - snwAmt)
    return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: ccAmt, snwService: r2(Math.max(snwAmt - ccAmt, 0)), clinicAmts: {} as Record<string, number> }
  }

  // ── PROGRAM ──
  const loc = locs.find(l => l.id === locId)
  const cl = loc?.clinic_id ? clinics.find(c => c.id === loc.clinic_id) : null

  if (cl) {
    const hasFlat = (cl.flat_clinic || 0) > 0

    if (hasFlat) {
      if (isPreAug) {
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
      }

      // ══════ POST-AUGUST 2025: PROPORTIONAL MODE ══════
      // flat_clinic = clinic's TOTAL target across full program.
      // Each payment: clinic gets (flat_clinic / programTotal) * payment.
      // SNW gets split_snw% of gross (includes CC). Higher rate to
      // catch up from pre-Aug 10% deficit.
      const snwPct = cl.split_snw || 26
      const snwTotal = r2(amt * snwPct / 100)
      const svcPortion = r2(Math.max(snwTotal - ccAmt, 0))

      if ((serviceTotal || 0) > 0) {
        const clinicGrossPct = (cl.flat_clinic || 0) / (serviceTotal || 1)
        let clinicAmt = r2(amt * clinicGrossPct)
        // Safety: clinic cannot exceed post-SNW pool
        clinicAmt = r2(Math.min(clinicAmt, Math.max(amt - snwTotal, 0)))
        let drAmt = r2(amt - snwTotal - clinicAmt)
        const drift = r2(amt - snwTotal - clinicAmt - drAmt)
        if (Math.abs(drift) >= 0.01) drAmt = r2(drAmt + drift)
        drAmt = Math.max(drAmt, 0) // Dr never negative
        return {
          snw: Math.max(snwTotal, 0),
          dr: drAmt,
          cc: ccAmt,
          snwService: Math.max(svcPortion, 0),
          clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
        }
      }

      // Fallback: no serviceTotal, use old waterfall
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
    } else {
      // ══════ PERCENTAGE MODE (no flat) ══════
      const snwAmt = r2(amt * cl.split_snw / 100)
      const clinicAmt = r2(amt * cl.split_clinic / 100)
      let drAmt = r2(amt - snwAmt - clinicAmt)
      const drift = r2(amt - snwAmt - clinicAmt - drAmt)
      drAmt = r2(drAmt + drift)
      return {
        snw: Math.max(snwAmt, 0),
        dr: Math.max(drAmt, 0),
        cc: ccAmt,
        snwService: r2(snwAmt - ccAmt),
        clinicAmts: { [cl.id]: Math.max(clinicAmt, 0) } as Record<string, number>,
      }
    }
  }

  // No clinic fallback
  const snwAmt = r2(amt * 81.01 / 100)
  const drAmt = r2(amt - snwAmt)
  return { snw: Math.max(snwAmt, 0), dr: Math.max(drAmt, 0), cc: ccAmt, snwService: r2(snwAmt - ccAmt), clinicAmts: {} as Record<string, number> }
}`);


// ══════════════════════════════════════════════════
// PATCH 2: SplitPrev signature
// ══════════════════════════════════════════════════
console.log('\n[2] Updating SplitPrev...');

patch('SplitPrev signature',
  'function SplitPrev({amt,svcType,locId,locs,clinics,cfg}:any) {\n  if (!amt||amt<=0) return null; const sp=calcSplit(amt,svcType,locId,locs,clinics,cfg)',
  'function SplitPrev({amt,svcType,locId,locs,clinics,cfg,serviceTotal,paymentDate}:any) {\n  if (!amt||amt<=0) return null; const sp=calcSplit(amt,svcType,locId,locs,clinics,cfg,serviceTotal,paymentDate)'
);

// Preview label
patch('Preview label',
  `Distribution Preview {isWaterfall?'(Waterfall)':svcType==='Map'?'(Map Split)':'(% Split)'}`,
  `Distribution Preview {isWaterfall?(paymentDate&&paymentDate<'2025-08-01'?'(Pre-Aug Legacy 10%)':'(Proportional)'):svcType==='Map'?'(Map Split)':'(% Split)'}`
);


// ══════════════════════════════════════════════════
// PATCH 3: All calcSplit call sites
// ══════════════════════════════════════════════════
console.log('\n[3] Updating calcSplit call sites...');

// 3A: Service summary
patch('Service summary calcSplit',
  'const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=calcSplit(svP,sv.service_type,cl.location_id,locs,clinics,cfg)',
  'const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=calcSplit(svP,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount)'
);

// 3B: Payment history rows
patch('Payment history calcSplit',
  'sv.payments.map((pm:AcctPayment)=>{const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg)',
  'sv.payments.map((pm:AcctPayment)=>{const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,pm.payment_date)'
);

// 3C: Add service preview
patch('Add service SplitPrev',
  '<SplitPrev amt={parseFloat(sf.a)||0} svcType={sf.t} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg}/>',
  '<SplitPrev amt={parseFloat(sf.a)||0} svcType={sf.t} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={parseFloat(sf.a)||0}/>'
);

// 3D: Add payment preview
patch('Add payment SplitPrev',
  '<SplitPrev amt={parseFloat(pf.a)||0} svcType={tSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg}/>',
  '<SplitPrev amt={parseFloat(pf.a)||0} svcType={tSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={tSvc.amount} paymentDate={pf.d}/>'
);

// 3E: Edit payment preview
patch('Edit payment SplitPrev',
  '{editSvc&&<SplitPrev amt={parseFloat(ef.a)||0} svcType={editSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg}/>}',
  '{editSvc&&<SplitPrev amt={parseFloat(ef.a)||0} svcType={editSvc.service_type} locId={cl.location_id} locs={locs} clinics={clinics} cfg={cfg} serviceTotal={editSvc.amount} paymentDate={ef.d}/>}'
);


// ══════════════════════════════════════════════════
// PATCH 4: Recon + PayView calcSplit calls
// ══════════════════════════════════════════════════
console.log('\n[4] Updating Recon + PayView...');

// ReconView
patch('ReconView calcSplit',
  `const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg)\n      months[mk].total+=pm.amount`,
  `const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,pm.payment_date)\n      months[mk].total+=pm.amount`
);

// PayView
patch('PayView calcSplit',
  `const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg)\n      o.dr+=sp.dr`,
  `const sp=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,pm.payment_date)\n      o.dr+=sp.dr`
);


// ══════════════════════════════════════════════════
// PATCH 5: Waterfall explanation + agreement terms
// ══════════════════════════════════════════════════
console.log('\n[5] Updating waterfall config UI...');

patch('Waterfall step 2 text',
  `2. Clinic gets <span className="text-amber-600 font-semibold">\${form.flatClinic||3395} flat</span> from remainder`,
  `2. Clinic target <span className="text-amber-600 font-semibold">\${form.flatClinic||3395}</span> distributed <span className="font-semibold">proportionally</span> across payments based on agreed program total`
);

patch('Waterfall step 3 text',
  `3. Dr. Yonce gets <span className="text-purple-600 font-semibold">everything left</span>`,
  `3. Dr. Yonce gets <span className="text-purple-600 font-semibold">the remainder</span> after SNW % and clinic proportional share`
);

// Add agreement terms after the purple explanation box
patch('Agreement terms block',
  `<p className="text-[10px] text-gray-400 mt-0.5">Automatically calculated. No configuration needed.</p>`,
  `<p className="text-[10px] text-gray-400 mt-0.5">Automatically calculated. No configuration needed.</p>
          </div>
          <div className="p-2.5 bg-amber-50 rounded-lg border border-amber-100 mt-2 space-y-1">
            <p className="text-[10px] font-semibold text-amber-700">Agreement Terms</p>
            <p className="text-[10px] text-amber-600">\u2022 Pre-Aug 2025: SNW received only 10% of gross. Post-Aug 2025: SNW at full split rate until deficit recovered.</p>
            <p className="text-[10px] text-amber-600">\u2022 All CC processing fees go to Sensorium.</p>
            <p className="text-[10px] text-amber-600">\u2022 Clinic submits biweekly invoice with session totals by client. Sensorium pays out on all sessions performed.</p>`
);

// Also update the flat fee help text
patch('Flat fee help text',
  `<span className="text-[10px] text-gray-400">taken from what's left after SNW %</span>`,
  `<span className="text-[10px] text-gray-400">total target across full program, paid proportionally per payment</span>`
);


// ══════════════════════════════════════════════════
// WRITE
// ══════════════════════════════════════════════════
writeFileSync(FILE, code, 'utf-8');

console.log(`\n=== Done: ${patches} patches applied ===`);
console.log('\nVerifications:');
console.log('  PRE_AUG_CUTOFF:', code.includes('PRE_AUG_CUTOFF') ? '✓' : '✗');
console.log('  serviceTotal param:', code.includes('serviceTotal') ? '✓' : '✗');
console.log('  paymentDate param:', code.includes('paymentDate') ? '✓' : '✗');
console.log('  proportionally:', code.includes('proportionally') ? '✓' : '✗');
console.log('  biweekly invoice:', code.includes('biweekly') ? '✓' : '✗');

console.log('\nNow run:');
console.log('  git add -A');
console.log('  git commit -m "fix: accounting proportional clinic payout + pre-Aug legacy 10% + CC fees + agreement terms"');
console.log('  git push');
