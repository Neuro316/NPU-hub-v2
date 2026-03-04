// ============================================================
// Feature: Collapsible sidebar + notes in quick-add
// Run: node fix-sidebar.mjs
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
console.log('====================================')
console.log(' Collapsible Sidebar + Quick-Add Notes')
console.log('====================================')
console.log('')

console.log('[1/4] Writing sidebar context...')
apply('src/lib/sidebar-context.ts', 'sidebar-context.ts')

console.log('[2/4] Updating sidebar...')
apply('src/components/sidebar.tsx', 'sidebar.txt')

console.log('[3/4] Updating dashboard layout...')
apply('src/app/(dashboard)/layout.tsx', 'layout.txt')

console.log('[4/4] Updating tasks page (notes in quick-add)...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page-v4.txt')

console.log('')
console.log('=== All patches applied (0 errors) ===')
console.log('')
console.log('Next steps:')
console.log('  git add -A')
console.log('  git commit -m "feat: collapsible sidebar with mobile support, notes in quick-add"')
console.log('  git push')
console.log('')
