// ============================================================
// CRM Bulk Action Fix + ECR Dynamic Pipeline Loading
// Run: node crm-bulk-fix.mjs
// ============================================================
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function apply(relPath, contentFile) {
  const content = fs.readFileSync(path.join(__dirname, contentFile), 'utf-8')
  const target = path.resolve(relPath)
  const dir = path.dirname(target)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(target, content, 'utf-8')
  console.log('  [WRITE] ' + relPath)
}

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' CRM Bulk Action Fix')
console.log('═══════════════════════════════════════════')
console.log('')

console.log('[1/4] Fixing bulk action API route (admin client, real affected counts)...')
apply('src/app/api/contacts/bulk-action/route.ts', 'bulk-action-route.txt')

console.log('[2/4] Fixing CRM client (return errors instead of throwing)...')
apply('src/lib/crm-client.ts', 'crm-client.txt')

console.log('[3/4] Fixing contacts page (show success/error feedback)...')
apply('src/app/(dashboard)/crm/contacts/page.tsx', 'crm-contacts-page.txt')

console.log('[4/4] Fixing ECR page (dynamic pipeline loading from org_settings)...')
apply('src/app/(dashboard)/ehr/ecr/page.tsx', 'ecr-page.txt')

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' All fixes applied!')
console.log('═══════════════════════════════════════════')
console.log('')
console.log('What was fixed:')
console.log('  1. Bulk actions now use admin client (bypasses RLS that was silently blocking updates)')
console.log('  2. Actual affected count returned (was lying about success)')
console.log('  3. Success/error feedback shown in bulk action bar')
console.log('  4. ECR now loads pipeline stages from org_settings dynamically')
console.log('')
console.log('Deploy:')
console.log('  git add -A')
console.log('  git commit -m "fix: bulk actions use admin client, show feedback, ECR dynamic pipelines"')
console.log('  git push')
console.log('')
