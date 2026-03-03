// fix-dollars.mjs - finds every broken $() and fixes to $$()
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/app/(dashboard)/ehr/accounting/page.tsx';
let code = readFileSync(FILE, 'utf-8');

// The currency formatter function is called $$()
// Every {$$( or ?$$( or :$$( pattern is correct
// Every {$( or ?$( or :$( where $ is followed by ( is BROKEN — missing a $

// Fix all patterns where a single $ precedes ( but should be $$
// We need to be careful not to touch legitimate single $ usage

let count = 0;

// Pattern: any of these prefixes followed by $( but NOT $$(
// {$( -> {$$(
// ?$( -> ?$$(
// >$( -> >$$(    (not needed, but safe)
// :$( -> :$$(    (ternary else)
// Also handle space variants like { $( -> { $$(

const fixed = code.replace(/(\{|\?|:)\s*\$\((?!\$)/g, (match, prefix) => {
  count++;
  // Preserve any whitespace between prefix and $
  const ws = match.slice(prefix.length, -2); // whitespace between prefix and $(
  return prefix + ws + '$$(';
});

if (count > 0) {
  writeFileSync(FILE, fixed, 'utf-8');
  console.log('Fixed ' + count + ' broken $() -> $$() instances');
} else {
  console.log('No broken $() found');
}

// Verify no broken ones remain
const remaining = (fixed || code).match(/[{?:]\s*\$\((?!\$)/g);
console.log('Remaining broken: ' + (remaining ? remaining.length : 0));

// Also verify $$ calls exist
const good = (fixed || code).match(/\$\$\(/g);
console.log('Valid $$() calls: ' + (good ? good.length : 0));
