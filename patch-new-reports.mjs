// patch-new-reports.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
const newJSX = readFileSync('new-reports.txt', 'utf-8');
let patches = 0;

function patch(label, old, replacement) {
  if (code.includes(old)) {
    code = code.replace(old, replacement);
    patches++;
    console.log('  + ' + label);
  } else {
    console.log('  SKIP: ' + label);
  }
}

console.log('=== Adding Collections + Monthly Collections reports ===\n');

// 1. Expand RptType
console.log('[1] Expanding RptType...');
patch('RptType',
  "type RptType = 'summary' | 'by_center' | 'by_client' | 'by_month' | 'payments' | 'payout_ledger'",
  "type RptType = 'summary' | 'by_center' | 'by_client' | 'by_month' | 'payments' | 'payout_ledger' | 'collections' | 'monthly_collections'"
);

// 2. Add state for service filter and entity toggles after selCtr state
console.log('[2] Adding filter state...');
patch('Filter state',
  "const [selCtr, setSelCtr] = useState<string>('all')",
  "const [selCtr, setSelCtr] = useState<string>('all')\n  const [selSvc, setSelSvc] = useState<string>('all')\n  const [showEnt, setShowEnt] = useState({snw:true,cli:true,dr:true})"
);

// 3. Add service type filter to allRows computation
// Insert after the selCtr filter line
console.log('[3] Adding service filter to allRows...');
patch('Service filter in allRows',
  "if (selCtr !== 'all' && cl.location_id !== selCtr) return",
  "if (selCtr !== 'all' && cl.location_id !== selCtr) return\n        if (selSvc !== 'all' && sv.service_type !== selSvc) return"
);

// Update useMemo deps for allRows to include selSvc
patch('allRows deps',
  "[clients, locs, clinics, cfg, dFrom, dTo, selCtr]",
  "[clients, locs, clinics, cfg, dFrom, dTo, selCtr, selSvc]"
);

// 4. Add service dropdown and entity toggles to filter bar
console.log('[4] Adding filter UI...');
// Insert after center select div
patch('Service + entity filters',
  "{(dFrom||dTo||selCtr!=='all')&&<button",
  "<div><label className=\"block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1\">Service</label><select value={selSvc} onChange={e=>setSelSvc(e.target.value)} className=\"px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30\"><option value=\"all\">All Services</option><option value=\"Map\">Map Only</option><option value=\"Program\">Program Only</option></select></div>\n      <div><label className=\"block text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1\">Entities</label><div className=\"flex gap-2 items-center py-1.5\">{[{k:'snw' as const,l:'SNW',c:'text-np-blue'},{k:'cli' as const,l:'Clinic',c:'text-amber-600'},{k:'dr' as const,l:'Dr.Y',c:'text-purple-600'}].map(e=><label key={e.k} className={'flex items-center gap-1 text-[11px] font-semibold cursor-pointer '+e.c}><input type=\"checkbox\" checked={showEnt[e.k]} onChange={()=>setShowEnt(p=>({...p,[e.k]:!p[e.k]}))} className=\"w-3 h-3 rounded\"/>{e.l}</label>)}</div></div>\n      {(dFrom||dTo||selCtr!=='all')&&<button"
);

// Update the clear button to also reset selSvc
patch('Clear button reset',
  "onClick={()=>{setDFrom('');setDTo('');setSelCtr('all')}}",
  "onClick={()=>{setDFrom('');setDTo('');setSelCtr('all');setSelSvc('all');setShowEnt({snw:true,cli:true,dr:true})}}"
);

// Also show clear when selSvc is set
patch('Clear button condition',
  "(dFrom||dTo||selCtr!=='all')&&<button onClick",
  "(dFrom||dTo||selCtr!=='all'||selSvc!=='all')&&<button onClick"
);

// 5. Add new tabs (after payout_ledger tab)
console.log('[5] Adding tabs...');
patch('Tab entries',
  "{k:'payout_ledger',l:'Payout Ledger',i:FileText}]",
  "{k:'payout_ledger',l:'Payout Ledger',i:FileText},{k:'collections',l:'Collections',i:TrendingUp},{k:'monthly_collections',l:'Monthly Collected',i:CalendarIcon}]"
);

// 6. Add export cases for new reports (before the closing } of doExport's payout_ledger)
console.log('[6] Adding export handlers...');
// Find end of payout_ledger export and add new cases after it
patch('Collections export',
  "downloadCSV('payout-ledger.csv', generateCSV(['Period','Payee','Amount','Notes'], ledger))\n    }",
  "downloadCSV('payout-ledger.csv', generateCSV(['Period','Payee','Amount','Notes'], ledger))\n    }\n    else if (rpt === 'collections') {\n      const m: Record<string, any> = {}\n      allRows.forEach(r => { const k=r.client+'|'+r.serviceType; if(!m[k])m[k]={name:r.client,loc:r.location,svc:r.serviceType,prog:0,coll:0,snw:0,cli:0,dr:0}; const x=m[k]; x.coll+=r.paymentAmt;x.snw+=r.snw;x.cli+=r.clinicAmt;x.dr+=r.dr; if(r.serviceTotal>x.prog)x.prog=r.serviceTotal })\n      const hdr=['Client','Center','Service','Program','Collected','Balance']; if(showEnt.snw)hdr.push('SNW'); if(showEnt.cli)hdr.push('Clinic'); if(showEnt.dr)hdr.push('Dr.Y')\n      const rws=Object.values(m).map((d:any)=>{const row=[d.name,d.loc,d.svc,r2(d.prog),r2(d.coll),r2(d.prog-d.coll)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); return row})\n      downloadCSV('collections-by-client.csv', generateCSV(hdr, rws))\n    }\n    else if (rpt === 'monthly_collections') {\n      const m: Record<string, any> = {}\n      allRows.forEach(r => { const mo=r.paymentDate.substring(0,7); if(!m[mo])m[mo]={coll:0,snw:0,cli:0,dr:0,n:0,cls:new Set()}; const x=m[mo]; x.coll+=r.paymentAmt;x.snw+=r.snw;x.cli+=r.clinicAmt;x.dr+=r.dr;x.n++;x.cls.add(r.client) })\n      const hdr=['Month','Collected']; if(showEnt.snw)hdr.push('SNW'); if(showEnt.cli)hdr.push('Clinic'); if(showEnt.dr)hdr.push('Dr.Y'); hdr.push('Clients','Payments')\n      const rws=Object.entries(m).sort(([a],[b])=>a.localeCompare(b)).map(([mo,d]:[string,any])=>{const row=[fMoL(mo),r2(d.coll)]; if(showEnt.snw)row.push(r2(d.snw)); if(showEnt.cli)row.push(r2(d.cli)); if(showEnt.dr)row.push(r2(d.dr)); row.push(d.cls.size,d.n); return row})\n      downloadCSV('monthly-collections.csv', generateCSV(hdr, rws))\n    }"
);

// 7. Insert new report render blocks before closing </div> of ReportView
console.log('[7] Inserting report render blocks...');
patch('New report renders',
  "    {rpt==='payout_ledger'&&<div className=\"space-y-4\">",
  newJSX + "\n\n    {rpt==='payout_ledger'&&<div className=\"space-y-4\">"
);

writeFileSync(FILE, code, 'utf-8');

console.log('\n=== Done: ' + patches + ' patches ===');
['collections', 'monthly_collections', 'selSvc', 'showEnt', 'service_type !== selSvc'].forEach(k => {
  console.log('  ' + k + ': ' + (code.includes(k) ? 'OK' : 'MISSING'));
});
