// fix-recon-export.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

console.log('=== Fix Recon CSV Export ===\n');

const oldExport = `else if (rpt === 'recon_detail') {
      const owedS = totals.snw, owedD = totals.dr
      const paidD = checks.filter(c=>c.payee_type==='dr').reduce((s,c)=>s+c.amount,0)
      const paidC: Record<string,number> = {}; clinics.forEach(c=>{paidC[c.id]=checks.filter(ch=>ch.payee_clinic_id===c.id).reduce((s,ch)=>s+ch.amount,0)})
      const mktgD = mktg.filter(m=>!m.waived&&m.payee_type==='dr').reduce((s,m)=>s+m.amount,0)
      const mktgC: Record<string,number> = {}; clinics.forEach(c=>{mktgC[c.id]=mktg.filter(m=>!m.waived&&m.payee_clinic_id===c.id).reduce((s,m)=>s+m.amount,0)})
      const summaryRows: any[][] = []
      if(showEnt.snw) summaryRows.push(['Sensorium (SNW)',r2(owedS),0,0,r2(owedS)])
      if(showEnt.cli) clinics.forEach(c=>{const o=totals.clinics[c.id]||0; summaryRows.push([c.name,r2(o),r2(paidC[c.id]||0),r2(mktgC[c.id]||0),r2(o-(paidC[c.id]||0)-(mktgC[c.id]||0))])})
      if(showEnt.dr) summaryRows.push(['Dr. Yonce',r2(owedD),r2(paidD),r2(mktgD),r2(owedD-paidD-mktgD)])
      downloadCSV('reconciliation.csv', generateCSV(['Entity','Split Owed','Checks Paid','Mktg Deductions','Net Owed'], summaryRows))
    }`;

const newExport = `else if (rpt === 'recon_detail') {
      const eH = entCols().map(c=>c.label)
      const rows: any[][] = []
      // Section 1: Revenue & Splits
      rows.push(['--- REVENUE COLLECTED & SPLITS ---'])
      rows.push(['Date','Client','Center','Payment',...eH])
      allRows.forEach(r => {
        const row: any[] = [r.paymentDate,r.client,r.location,r2(r.paymentAmt)]
        if(showEnt.snw) row.push(r2(r.snw))
        if(showEnt.cli) row.push(r2(r.clinicAmt))
        if(showEnt.dr) row.push(r2(r.dr))
        rows.push(row)
      })
      const splitRow: any[] = ['TOTAL','','',r2(totals.revenue)]
      if(showEnt.snw) splitRow.push(r2(totals.snw))
      if(showEnt.cli) splitRow.push(r2(totalClinic))
      if(showEnt.dr) splitRow.push(r2(totals.dr))
      rows.push(splitRow)
      rows.push([])
      // Section 2: Checks/ACH Paid
      const visChecks = checks.filter(ch => (ch.payee_type==='dr'&&showEnt.dr)||(ch.payee_type!=='dr'&&showEnt.cli)).sort((a,b)=>a.check_date.localeCompare(b.check_date))
      if (visChecks.length > 0) {
        rows.push(['--- PAYMENTS MADE (CHECKS & ACH) ---'])
        rows.push(['Date','Check #','Payee','Amount','Memo'])
        visChecks.forEach(ch => {
          const payee = ch.payee_type==='dr'?'Dr. Yonce':clinics.find(c=>c.id===ch.payee_clinic_id)?.name||'Clinic'
          rows.push([ch.check_date,ch.check_number,payee,r2(ch.amount),ch.memo||''])
        })
        rows.push(['TOTAL PAID','','',r2(visChecks.reduce((s,c)=>s+c.amount,0))])
        rows.push([])
      }
      // Section 3: Reconciliation Summary
      const paidD = checks.filter(c=>c.payee_type==='dr').reduce((s,c)=>s+c.amount,0)
      const paidC: Record<string,number> = {}; clinics.forEach(c=>{paidC[c.id]=checks.filter(ch=>ch.payee_clinic_id===c.id).reduce((s,ch)=>s+ch.amount,0)})
      const mktgD = mktg.filter(m=>!m.waived&&m.payee_type==='dr').reduce((s,m)=>s+m.amount,0)
      const mktgC: Record<string,number> = {}; clinics.forEach(c=>{mktgC[c.id]=mktg.filter(m=>!m.waived&&m.payee_clinic_id===c.id).reduce((s,m)=>s+m.amount,0)})
      rows.push(['--- RECONCILIATION SUMMARY ---'])
      rows.push(['Entity','Split Owed','Paid Out','Ad Spend','Still Owed'])
      let tOwed=0,tPaid=0,tMktg=0,tNet=0
      if(showEnt.snw){const o=r2(totals.snw);tOwed+=o;rows.push(['Sensorium (SNW)',o,0,0,o])}
      if(showEnt.cli) clinics.forEach(c=>{const o=r2(totals.clinics[c.id]||0);const p=r2(paidC[c.id]||0);const m=r2(mktgC[c.id]||0);const n=r2(o-p-m);if(o>0.01||p>0.01){tOwed+=o;tPaid+=p;tMktg+=m;tNet+=n;rows.push([c.name,o,p,m,n])}})
      if(showEnt.dr){const o=r2(totals.dr);const p=r2(paidD);const m=r2(mktgD);const n=r2(o-p-m);tOwed+=o;tPaid+=p;tMktg+=m;tNet+=n;rows.push(['Dr. Yonce',o,p,m,n])}
      rows.push(['TOTAL',r2(tOwed),r2(tPaid),r2(tMktg),r2(tNet)])
      downloadCSV('reconciliation.csv', generateCSV(rows[0].map(()=>''), rows))
    }`;

if (code.includes(oldExport)) {
  code = code.replace(oldExport, newExport);
  console.log('  + Replaced recon export with full 3-section CSV');
} else {
  console.log('  SKIP: old export not found');
  // Try a shorter match
  const shortMatch = "else if (rpt === 'recon_detail')";
  const idx = code.indexOf(shortMatch);
  if (idx >= 0) {
    console.log('  Found recon_detail at char ' + idx);
    console.log('  Context: ' + code.substring(idx, idx + 100));
  }
}

// Verify
console.log('  REVENUE COLLECTED: ' + (code.includes('REVENUE COLLECTED') ? 'OK' : 'MISSING'));
console.log('  PAYMENTS MADE: ' + (code.includes('PAYMENTS MADE') ? 'OK' : 'MISSING'));
console.log('  RECONCILIATION SUMMARY: ' + (code.includes('RECONCILIATION SUMMARY') ? 'OK' : 'MISSING'));

writeFileSync(FILE, code, 'utf-8');
console.log('\n=== Done ===');
