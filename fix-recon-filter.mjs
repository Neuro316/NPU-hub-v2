// fix-recon-filter.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

console.log('=== Fix Recon: filter zero entities, real net ===\n');

// Fix 1: After entities are built, filter out zero-activity ones
// Find where entities array is built and add a filter
const oldGrand = "const grandOwed = r2(entities.reduce((s,e)=>s+e.splitOwed,0))";
const newGrand = "const activeEntities = entities.filter(e => e.splitOwed > 0 || e.checksPaid > 0 || e.mktgDed > 0)\n      const grandOwed = r2(activeEntities.reduce((s,e)=>s+e.splitOwed,0))";

if (code.includes(oldGrand)) {
  code = code.replace(oldGrand, newGrand);
  console.log('  + Added activeEntities filter');
} else {
  console.log('  SKIP: grandOwed line not found');
}

// Fix 2: Replace all remaining entities.reduce with activeEntities.reduce
code = code.replace(
  /const grandPaid = r2\(entities\.reduce/,
  'const grandPaid = r2(activeEntities.reduce'
);
code = code.replace(
  /const grandMktg = r2\(entities\.reduce/,
  'const grandMktg = r2(activeEntities.reduce'
);
code = code.replace(
  /const grandNet = r2\(entities\.reduce/,
  'const grandNet = r2(activeEntities.reduce'
);
console.log('  + Updated grand totals to use activeEntities');

// Fix 3: Replace entities.map in the table with activeEntities.map
const oldEntMap = "{entities.map(e => <tr key={e.key}";
const newEntMap = "{activeEntities.map(e => <tr key={e.key}";
if (code.includes(oldEntMap)) {
  code = code.replace(oldEntMap, newEntMap);
  console.log('  + Table rows use activeEntities');
} else {
  console.log('  SKIP: entities.map not found');
}

// Fix 4: Fix the Settled logic - show real net, only Settled if truly ~0
// Replace the net cell for individual rows
const oldNetCell = "style={{fontFeatureSettings:'\"tnum\"',color:e.net>0.01?'#d97706':'#16a34a'}}>{e.net>0.01?F(e.net):'Settled'}";
const newNetCell = "style={{fontFeatureSettings:'\"tnum\"',color:Math.abs(e.net)<0.01?'#16a34a':e.net>0?'#d97706':'#dc2626'}}>{Math.abs(e.net)<0.01?'Settled':F(e.net)}";
if (code.includes(oldNetCell)) {
  code = code.replace(oldNetCell, newNetCell);
  console.log('  + Fixed entity net cell (shows negative)');
} else {
  console.log('  SKIP: entity net cell not found');
}

// Fix the grand total net cell
const oldGrandNet = "style={{fontFeatureSettings:'\"tnum\"',color:grandNet>0.01?'#d97706':'#16a34a'}}>{grandNet>0.01?F(grandNet):'Settled'}";
const newGrandNet = "style={{fontFeatureSettings:'\"tnum\"',color:Math.abs(grandNet)<0.01?'#16a34a':grandNet>0?'#d97706':'#dc2626'}}>{Math.abs(grandNet)<0.01?'Settled':F(grandNet)}";
if (code.includes(oldGrandNet)) {
  code = code.replace(oldGrandNet, newGrandNet);
  console.log('  + Fixed grand total net cell');
} else {
  console.log('  SKIP: grand net cell not found');
}

// Fix the grand mktg cell too
const oldGrandMktg = "style={{fontFeatureSettings:'\"tnum\"'}}>{grandMktg>0.01?'-'+F(grandMktg):'\\\\u2014'}";
const newGrandMktg = "style={{fontFeatureSettings:'\"tnum\"'}}>{grandMktg>0.01?'-'+F(grandMktg):'\\u2014'}";
if (code.includes(oldGrandMktg)) {
  code = code.replace(oldGrandMktg, newGrandMktg);
  console.log('  + Fixed grand mktg unicode');
}

// Verify
let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('\n  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));
console.log('  activeEntities: ' + (code.includes('activeEntities') ? 'OK' : 'MISSING'));
console.log('  Math.abs(e.net): ' + (code.includes('Math.abs(e.net)') ? 'OK' : 'MISSING'));

writeFileSync(FILE, code, 'utf-8');
console.log('\n=== Done ===');
