// fix-recon-totals.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

console.log('=== Fix Reconciliation Totals & Layout ===\n');

// Find the recon block
const reconStart = code.indexOf("{/* == RECONCILIATION == */}");
if (reconStart < 0) {
  console.log('ERROR: recon block not found');
  process.exit(1);
}

// Find the next block after recon
const reconEnd = code.indexOf("{/* == BY CENTER == */}", reconStart);
if (reconEnd < 0) {
  console.log('ERROR: next block not found');
  process.exit(1);
}

const oldRecon = code.substring(reconStart, reconEnd);
console.log('  Found recon block: ' + oldRecon.length + ' chars');

const newRecon = `{/* == RECONCILIATION == */}
    {rpt==='recon_detail'&&(()=>{
      // Compute splits owed per entity
      const owed: Record<string, number> = { snw: totals.snw, dr: totals.dr }
      clinics.forEach(c => { owed['clinic_'+c.id] = totals.clinics[c.id] || 0 })

      // Compute checks paid per entity
      const paid: Record<string, number> = { snw: 0, dr: 0 }
      clinics.forEach(c => { paid['clinic_'+c.id] = 0 })
      checks.forEach(ch => {
        if (ch.payee_type === 'dr') paid.dr += ch.amount
        else if (ch.payee_clinic_id) paid['clinic_'+ch.payee_clinic_id] = (paid['clinic_'+ch.payee_clinic_id] || 0) + ch.amount
      })

      // Marketing deductions per entity
      const mktgTotals: Record<string, number> = { snw: 0, dr: 0 }
      clinics.forEach(c => { mktgTotals['clinic_'+c.id] = 0 })
      mktg.forEach(m => {
        if (m.waived) return
        if (m.payee_type === 'dr') mktgTotals.dr += m.amount
        else if (m.payee_clinic_id) mktgTotals['clinic_'+m.payee_clinic_id] = (mktgTotals['clinic_'+m.payee_clinic_id] || 0) + m.amount
      })

      // Filter checks by selected entities
      const visibleChecks = checks.filter(ch => {
        if (ch.payee_type === 'dr' && showEnt.dr) return true
        if (ch.payee_type !== 'dr' && showEnt.cli) return true
        return false
      }).sort((a,b) => a.check_date.localeCompare(b.check_date))

      const visibleCheckTotal = visibleChecks.reduce((s,c) => s + c.amount, 0)

      // Entity summary rows
      type EntRow = { name: string; key: string; color: string; splitOwed: number; checksPaid: number; mktgDed: number; net: number }
      const entities: EntRow[] = []
      if (showEnt.snw) {
        const net = r2(owed.snw - (paid.snw||0) - (mktgTotals.snw||0))
        entities.push({ name: 'Sensorium (SNW)', key: 'snw', color: 'text-np-blue', splitOwed: r2(owed.snw), checksPaid: r2(paid.snw||0), mktgDed: r2(mktgTotals.snw||0), net })
      }
      if (showEnt.cli) {
        clinics.forEach(c => {
          const k = 'clinic_'+c.id
          const net = r2((owed[k]||0) - (paid[k]||0) - (mktgTotals[k]||0))
          entities.push({ name: c.name.split('(')[0].trim(), key: k, color: 'text-amber-600', splitOwed: r2(owed[k]||0), checksPaid: r2(paid[k]||0), mktgDed: r2(mktgTotals[k]||0), net })
        })
      }
      if (showEnt.dr) {
        const net = r2(owed.dr - (paid.dr||0) - (mktgTotals.dr||0))
        entities.push({ name: 'Dr. Yonce', key: 'dr', color: 'text-purple-600', splitOwed: r2(owed.dr), checksPaid: r2(paid.dr||0), mktgDed: r2(mktgTotals.dr||0), net })
      }
      const grandOwed = r2(entities.reduce((s,e)=>s+e.splitOwed,0))
      const grandPaid = r2(entities.reduce((s,e)=>s+e.checksPaid,0))
      const grandMktg = r2(entities.reduce((s,e)=>s+e.mktgDed,0))
      const grandNet = r2(entities.reduce((s,e)=>s+e.net,0))

      return <div className="space-y-5">

        {/* 1. Payment Splits - what came in and how it splits */}
        <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between"><h3 className="text-sm font-semibold text-np-dark">Revenue Collected & Splits</h3><span className="text-xs text-gray-400">{allRows.length} payments</span></div>
          <div className="overflow-auto max-h-[400px]"><table className="w-full text-left"><thead className="sticky top-0 bg-white z-10"><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Date</RTH><RTH>Client</RTH><RTH>Center</RTH><RTH className="text-right">Payment</RTH>
            {ec.map(c=><RTH key={c.key} className={'text-right '+c.color}>{c.label}</RTH>)}
            </tr></thead><tbody>
            {allRows.map((r,i)=><tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fD(r.paymentDate)}</td>
              <td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{r.client}</td>
              <td className="py-1.5 px-3"><LocTag loc={r.locationId} locs={locs}/></td>
              <td className="py-1.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.paymentAmt)}</td>
              {showEnt.snw&&<td className="py-1.5 px-3 text-xs text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.snw)}</td>}
              {showEnt.cli&&<td className="py-1.5 px-3 text-xs text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{r.clinicAmt>0?F(r.clinicAmt):'\\u2014'}</td>}
              {showEnt.dr&&<td className="py-1.5 px-3 text-xs text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r.dr)}</td>}
              </tr>)}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200 sticky bottom-0 z-10">
              <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.revenue))}</td>
              {showEnt.snw&&<td className="py-2.5 px-3 text-xs font-bold text-np-blue text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.snw))}</td>}
              {showEnt.cli&&<td className="py-2.5 px-3 text-xs font-bold text-amber-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totalClinic))}</td>}
              {showEnt.dr&&<td className="py-2.5 px-3 text-xs font-bold text-purple-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(totals.dr))}</td>}
              </tr>
          </tbody></table></div></div>

        {/* 2. Checks Written - what was paid out */}
        {visibleChecks.length>0&&<div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between"><h3 className="text-sm font-semibold text-np-dark">Payments Made (Checks & ACH)</h3><span className="text-xs text-gray-400">{visibleChecks.length} payments</span></div>
          <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Date</RTH><RTH>Check #</RTH><RTH>Payee</RTH><RTH className="text-right">Amount</RTH><RTH>Memo</RTH></tr></thead><tbody>
            {visibleChecks.map((ch,i)=>{
              const payee = ch.payee_type==='dr'?'Dr. Yonce':clinics.find(c=>c.id===ch.payee_clinic_id)?.name?.split('(')[0]?.trim()||'Clinic'
              return <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="py-1.5 px-3 text-xs text-gray-600 whitespace-nowrap">{fD(ch.check_date)}</td>
                <td className="py-1.5 px-3 text-xs font-semibold text-np-dark">{ch.check_number}</td>
                <td className="py-1.5 px-3 text-xs text-gray-600">{payee}</td>
                <td className="py-1.5 px-3 text-xs font-semibold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(ch.amount)}</td>
                <td className="py-1.5 px-3 text-xs text-gray-400">{ch.memo||''}</td></tr>})}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200">
              <td className="py-2.5 px-3 text-xs font-bold" colSpan={3}>TOTAL PAID</td>
              <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(r2(visibleCheckTotal))}</td>
              <td></td></tr>
          </tbody></table></div></div>}

        {/* 3. Reconciliation Summary - split owed vs paid vs net */}
        <div className="rounded-xl border-2 border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-bold text-np-dark">Reconciliation Summary</h3></div>
          <div className="overflow-auto"><table className="w-full text-left"><thead><tr className="border-b border-gray-100 bg-gray-50/30">
            <RTH>Entity</RTH><RTH className="text-right">Split Owed</RTH><RTH className="text-right text-green-600">Paid Out</RTH><RTH className="text-right text-red-500">Mktg Ded.</RTH><RTH className="text-right">Net Owed</RTH></tr></thead><tbody>
            {entities.map(e => <tr key={e.key} className="border-b border-gray-50 hover:bg-gray-50/50">
              <td className={'py-2.5 px-3 text-xs font-semibold '+e.color}>{e.name}</td>
              <td className="py-2.5 px-3 text-xs font-semibold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(e.splitOwed)}</td>
              <td className="py-2.5 px-3 text-xs text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{e.checksPaid>0?F(e.checksPaid):'\\u2014'}</td>
              <td className="py-2.5 px-3 text-xs text-red-500 text-right" style={{fontFeatureSettings:'"tnum"'}}>{e.mktgDed>0?'-'+F(e.mktgDed):'\\u2014'}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"',color:e.net>0.01?'#d97706':'#16a34a'}}>{e.net>0.01?F(e.net):'Settled'}</td></tr>)}
            <tr className="bg-gray-50/50 border-t-2 border-gray-200">
              <td className="py-2.5 px-3 text-xs font-bold">TOTAL</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(grandOwed)}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-green-600 text-right" style={{fontFeatureSettings:'"tnum"'}}>{F(grandPaid)}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-red-500 text-right" style={{fontFeatureSettings:'"tnum"'}}>{grandMktg>0.01?'-'+F(grandMktg):'\\u2014'}</td>
              <td className="py-2.5 px-3 text-xs font-bold text-right" style={{fontFeatureSettings:'"tnum"',color:grandNet>0.01?'#d97706':'#16a34a'}}>{grandNet>0.01?F(grandNet):'Settled'}</td></tr>
          </tbody></table></div></div>

      </div>
    })()}

    `;

code = code.substring(0, reconStart) + newRecon + code.substring(reconEnd);
console.log('  + Reconciliation block replaced');

// Verify
let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));

const broken = code.match(/\{\$\((?!\$)/g);
console.log('  Broken $() calls: ' + (broken ? broken.length : 0));

writeFileSync(FILE, code, 'utf-8');
console.log('\n=== Done ===');
