// fix-recon-v2.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

console.log('=== Fix Recon v2: hide zero-split, add summary ===\n');

// Fix 1: Change filter to only show entities with actual revenue or checks
const oldFilter = "const activeEntities = entities.filter(e => e.splitOwed > 0 || e.checksPaid > 0 || e.mktgDed > 0)";
const newFilter = "const activeEntities = entities.filter(e => e.splitOwed > 0.01 || e.checksPaid > 0.01)";

if (code.includes(oldFilter)) {
  code = code.replace(oldFilter, newFilter);
  console.log('  + Fixed filter: only entities with revenue or checks');
} else {
  console.log('  SKIP: filter not found');
}

// Fix 2: Add summary cards above the reconciliation table
// Find the Reconciliation Summary div
const oldSummaryHeader = `<div className="rounded-xl border-2 border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-bold text-np-dark">Reconciliation Summary</h3></div>`;

const newSummaryWithCards = `{/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Total Split</p><p className="text-lg font-bold text-np-dark" style={{fontFeatureSettings:'"tnum"'}}>{F(grandOwed)}</p></div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-green-500 mb-1">Total Payout</p><p className="text-lg font-bold text-green-600" style={{fontFeatureSettings:'"tnum"'}}>{F(grandPaid)}</p></div>
          <div className="rounded-xl border border-gray-200 bg-white p-4 text-center"><p className="text-[10px] font-semibold uppercase tracking-wider text-red-400 mb-1">Total Ad Spend</p><p className="text-lg font-bold text-red-500" style={{fontFeatureSettings:'"tnum"'}}>{grandMktg>0.01?'-'+F(grandMktg):'$0.00'}</p></div>
          <div className="rounded-xl border-2 bg-white p-4 text-center" style={{borderColor:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}><p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">Still Owed</p><p className="text-lg font-bold" style={{fontFeatureSettings:'"tnum"',color:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}>{Math.abs(grandNet)<0.01?'Settled':F(grandNet)}</p></div>
        </div>

        <div className="rounded-xl border-2 border-gray-200 bg-white overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gray-50/50"><h3 className="text-sm font-bold text-np-dark">Reconciliation Summary</h3></div>`;

if (code.includes(oldSummaryHeader)) {
  code = code.replace(oldSummaryHeader, newSummaryWithCards);
  console.log('  + Added summary cards (Split, Payout, Ad Spend, Still Owed)');
} else {
  console.log('  SKIP: summary header not found');
}

// Verify
let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('\n  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));
console.log('  activeEntities filter: ' + (code.includes('splitOwed > 0.01 || e.checksPaid > 0.01') ? 'OK' : 'MISSING'));
console.log('  Summary cards: ' + (code.includes('Total Split') ? 'OK' : 'MISSING'));
console.log('  Total Payout: ' + (code.includes('Total Payout') ? 'OK' : 'MISSING'));
console.log('  Total Ad Spend: ' + (code.includes('Total Ad Spend') ? 'OK' : 'MISSING'));
console.log('  Still Owed: ' + (code.includes('Still Owed') ? 'OK' : 'MISSING'));

writeFileSync(FILE, code, 'utf-8');
console.log('\n=== Done ===');
