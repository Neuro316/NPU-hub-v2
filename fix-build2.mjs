// fix-build2.mjs
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');
const RC = readFileSync('report-component.txt', 'utf-8');

console.log('=== Clean Fix: Remove all ReportView content, reinsert from file ===\n');

// Find the FIRST occurrence of any ReportView-related content
// The original patch inserted before /* ── Reconciliation
// Look for generateCSV or ReportView - whichever comes first
const markers = [
  '/* \u2550\u2550 COMPREHENSIVE REPORTING SUITE',
  'function generateCSV',
  'function ReportView',
  'function downloadCSV',
  'type RptType',
];

let earliest = code.length;
for (const m of markers) {
  const idx = code.indexOf(m);
  if (idx >= 0 && idx < earliest) earliest = idx;
}

// Find /* ── Reconciliation marker
const reconMarker = '/* \u2500\u2500 Reconciliation';
const reconIdx = code.indexOf(reconMarker);

if (earliest < code.length && reconIdx > earliest) {
  // Go back to previous newline for clean cut
  let cutStart = code.lastIndexOf('\n', earliest);
  if (cutStart < 0) cutStart = earliest;
  
  const before = code.substring(0, cutStart);
  const after = code.substring(reconIdx);
  
  code = before + '\n\n' + RC + '\n\n' + after;
  
  console.log('  Cut from char ' + cutStart + ' to ' + reconIdx);
  console.log('  Inserted ' + RC.length + ' chars from report-component.txt');
  console.log('  \u2713 Clean replacement done');
} else {
  console.log('  earliest marker at: ' + earliest);
  console.log('  reconIdx at: ' + reconIdx);
  console.log('  \u2717 Could not find boundaries');
}

writeFileSync(FILE, code, 'utf-8');

// Verify brace balance
let depth = 0;
for (const ch of code) {
  if (ch === '{') depth++;
  if (ch === '}') depth--;
}
console.log('\nBrace balance: ' + depth + (depth === 0 ? ' \u2713' : ' \u2717 MISMATCH'));

// Verify key functions exist exactly once
for (const fn of ['function ReportView', 'function ReconView', 'function calcSplit', 'export default function']) {
  const count = code.split(fn).length - 1;
  console.log('  ' + fn + ': ' + count + 'x' + (count === 1 ? ' \u2713' : ' \u2717'));
}
