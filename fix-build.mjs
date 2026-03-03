// fix-build.mjs - reads component from report-component.txt to avoid $ issues
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

// Read the component from the separate file (no template literal issues)
const RC = readFileSync('report-component.txt', 'utf-8');

console.log('=== Fix Build: Replace truncated ReportView ===\n');

// Find where the broken content starts
const broken = "else if (rpt === 'by_month') downloadCSV('accounting-by-month.csv', generateCSV(['Month','Revenue','SNW','Clinic','Dr.Y','Payments','Legacy";

if (code.includes(broken)) {
  const idx = code.indexOf(broken);
  // Find the start of the doExport line block (go back to find 'else if')
  // Actually find start of the broken export line
  let lineStart = code.lastIndexOf('\n', idx) + 1;
  
  // Find where ReconView starts (after the truncated content)
  const reconMarker = '/* \u2500\u2500 Reconciliation';
  const reconIdx = code.indexOf(reconMarker, idx);
  
  if (reconIdx > 0) {
    // Remove everything from the broken line to ReconView, replace with correct component ending + ReconView marker
    const before = code.substring(0, lineStart);
    const after = code.substring(reconIdx);
    
    // Build the fix: complete doExport function + rest of ReportView + gap before ReconView
    code = before + RC + '\n' + after;
    console.log('  \u2713 Replaced truncated ReportView with complete component from file');
  } else {
    console.log('  \u2717 Could not find ReconView marker');
  }
} else if (code.includes('function ReportView')) {
  // ReportView exists but may be complete - check if it has the payout_ledger section
  if (code.includes("rpt==='payout_ledger'")) {
    console.log('  \u2713 ReportView already complete');
  } else {
    console.log('  \u2717 ReportView exists but incomplete - manual fix needed');
  }
} else {
  console.log('  \u2717 No broken pattern found and no ReportView exists');
}

writeFileSync(FILE, code, 'utf-8');

console.log('\nVerifications:');
['function ReportView', 'function ReconView', 'generateCSV', 'downloadCSV', 'payout_ledger', "vw==='reports'"].forEach(k => {
  console.log('  ' + k + ': ' + (code.includes(k) ? '\u2713' : '\u2717'));
});
