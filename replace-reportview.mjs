// replace-reportview.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
const newComponent = readFileSync('report-view-v2.txt', 'utf-8');

console.log('=== Replacing ReportView with v2 ===\n');

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
    console.log('  Found marker: "' + m + '" at ' + idx);
  }
}

if (startIdx < 0) {
  console.log('ERROR: No markers found');
  process.exit(1);
}

let lineStart = startIdx;
while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;
const prevNL = code.lastIndexOf('\n', lineStart - 2);
if (prevNL >= 0 && code.substring(prevNL, lineStart).includes('/*')) {
  lineStart = prevNL + 1;
}

const endMarker = 'function ReconView';
let endIdx = code.indexOf(endMarker, startIdx);
if (endIdx < 0) {
  console.log('ERROR: Could not find ReconView');
  process.exit(1);
}

let endLine = endIdx;
while (endLine > 0 && code[endLine - 1] !== '\n') endLine--;
const prevEnd = code.lastIndexOf('\n', endLine - 2);
if (prevEnd >= 0 && code.substring(prevEnd, endLine).includes('/*')) {
  endLine = prevEnd + 1;
}

console.log('  Replacing chars ' + lineStart + '..' + endLine);

code = code.substring(0, lineStart) + newComponent + '\n' + code.substring(endLine);

let depth = 0;
for (const ch of code) { if (ch === '{') depth++; if (ch === '}') depth--; }
console.log('  Brace balance: ' + depth + (depth === 0 ? ' OK' : ' MISMATCH'));

['function generateCSV','function downloadCSV','function ReportView','function ReconView'].forEach(fn => {
  const n = code.split(fn).length - 1;
  console.log('  ' + fn + ': ' + n + 'x' + (n === 1 ? ' OK' : ' ERR'));
});

['collections','monthly_collections','recon_detail','showEnt','selSvc'].forEach(f => {
  console.log('  ' + f + ': ' + (code.includes(f) ? 'OK' : 'MISSING'));
});

writeFileSync(FILE, code, 'utf-8');
console.log('\nDone');
