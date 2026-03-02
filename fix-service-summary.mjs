// fix-service-summary.mjs
// Run: node fix-service-summary.mjs
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
    console.log(`  ✗ SKIP: ${label}`);
  }
}

console.log('=== Fixing service summary splits ===\n');

// The service summary computes one calcSplit on the total paid amount
// but doesn't pass paymentDate, so pre-Aug payments default to post-Aug rates.
// Fix: compute per-payment and sum the results.

patch('Service summary per-payment splits',
  `const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=calcSplit(svP,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount)`,
  `const svP=sv.payments.reduce((s:number,p:AcctPayment)=>s+p.amount,0);const sp=sv.payments.reduce((acc,pm)=>{const s=calcSplit(pm.amount,sv.service_type,cl.location_id,locs,clinics,cfg,sv.amount,pm.payment_date);return{snw:r2(acc.snw+s.snw),dr:r2(acc.dr+s.dr),cc:r2(acc.cc+s.cc),snwService:r2(acc.snwService+s.snwService),clinicAmts:Object.fromEntries(Object.entries(s.clinicAmts).map(([k,v])=>[k,r2((acc.clinicAmts[k]||0)+v)]))}},{snw:0,dr:0,cc:0,snwService:0,clinicAmts:{}} as ReturnType<typeof calcSplit>)`
);

writeFileSync(FILE, code, 'utf-8');
console.log(`\n=== Done: ${patches} patches ===`);
console.log('Now: git add -A && git commit -m "fix: service summary uses per-payment date for pre-Aug splits" && git push');
