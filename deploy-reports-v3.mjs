// deploy-reports-v3.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
const newComponent = readFileSync('report-view-v3.txt', 'utf-8');

console.log('=== Deploy Reports v3 (all-in-one) ===\n');

// 1. Replace entire ReportView block
const markers = [
  'COMPREHENSIVE REPORTING SUITE',
  'function generateCSV',
  'function downloadCSV',
  'type RptType',
  'function ReportView',
];

let startIdx = -1;
for (const m of markers) {
  const idx = code.indexOf(m);
  if (idx >= 0 && (startIdx < 0 || idx < startIdx)) {
    startIdx = idx;
    console.log('  Found: "' + m + '" at ' + idx);
  }
}

if (startIdx < 0) { console.log('ERROR: No markers'); process.exit(1); }

let lineStart = startIdx;
while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;
const prevNL = code.lastIndexOf('\n', lineStart - 2);
if (prevNL >= 0 && code.substring(prevNL, lineStart).includes('/*')) lineStart = prevNL + 1;

const endMarker = 'function ReconView';
let endIdx = code.indexOf(endMarker, startIdx);
if (endIdx < 0) { console.log('ERROR: No ReconView'); process.exit(1); }

let endLine = endIdx;
while (endLine > 0 && code[endLine - 1] !== '\n') endLine--;
const prevEnd = code.lastIndexOf('\n', endLine - 2);
if (prevEnd >= 0 && code.substring(prevEnd, endLine).includes('/*')) endLine = prevEnd + 1;

console.log('  Replacing chars ' + lineStart + '..' + endLine);
code = code.substring(0, lineStart) + newComponent + '\n' + code.substring(endLine);
console.log('  + ReportView replaced');

// 2. Wire checks/mktg into render call
const oldRender = ":vw==='reports'?<ReportView clients={clients} locs={locs} clinics={clinics} cfg={config}/>";
const newRender = ":vw==='reports'?<ReportView clients={clients} locs={locs} clinics={clinics} cfg={config} checks={checks} mktg={mktg}/>";
if (code.includes(oldRender)) {
  code = code.replace(oldRender, newRender);
  console.log('  + Render props updated (checks/mktg)');
} else if (code.includes(newRender)) {
  console.log('  = Render props already have checks/mktg');
} else {
  console.log('  WARN: Could not find render line');
}

// 3. Ensure Reports nav item exists
if (!code.includes("k:'reports'")) {
  const navOld = "{k:'recon',icon:BarChart3,l:'Reconciliation'},{k:'settings'";
  const navNew = "{k:'recon',icon:BarChart3,l:'Reconciliation'},{k:'reports',icon:FileText,l:'Reports'},{k:'settings'";
  if (code.includes(navOld)) {
    code = code.replace(navOld, navNew);
    console.log('  + Reports nav item added');
  } else {
    console.log('  WARN: Nav pattern not found');
  }
} else {
  console.log('  = Reports nav already exists');
}

// 4. Ensure icon imports
const neededIcons = ['Download', 'FileText', 'Building2', 'TrendingUp', 'Wallet'];
const importLine = code.match(/import \{[^}]+\} from 'lucide-react'/);
if (importLine) {
  let il = importLine[0];
  let changed = false;
  for (const icon of neededIcons) {
    if (!il.includes(icon)) {
      il = il.replace("} from 'lucide-react'", ", " + icon + " } from 'lucide-react'");
      changed = true;
      console.log('  + Added icon import: ' + icon);
    }
  }
  if (changed) code = code.replace(importLine[0], il);
  else console.log('  = All icons already imported');
}

// 5. Verify
let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('\n  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));

['function generateCSV','function downloadCSV','function ReportView','function ReconView','function PayView'].forEach(fn => {
  const n = code.split(fn).length - 1;
  console.log('  ' + fn + ': ' + n + 'x' + (n === 1 ? ' OK' : ' ERR'));
});

const features = ['collections','monthly_collections','recon_detail','showEnt','selSvc','checks: AcctCheck','mktg: AcctMktgCharge','Checks Written','Split Owed','F(totals'];
features.forEach(f => {
  console.log('  ' + f.substring(0,25) + ': ' + (code.includes(f) ? 'OK' : 'MISSING'));
});

// Check no broken $( calls
const broken = code.match(/\{\$\((?!\$)/g);
console.log('  Broken $() calls: ' + (broken ? broken.length : 0));

writeFileSync(FILE, code, 'utf-8');
console.log('\n=== Done ===');
