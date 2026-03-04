// ============================================================
// Fix: My Tasks filter + logActivity null issues
// Run: node fix-mytasks.mjs
// ============================================================
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function applyFix(relPath, contentFile) {
  const content = fs.readFileSync(path.join(__dirname, contentFile), 'utf-8')
  const target = path.resolve(relPath)
  const dir = path.dirname(target)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(target, content, 'utf-8')
  console.log(`  [WRITE] ${relPath}`)
}

console.log('')
console.log('Applying fixes...')
applyFix('src/lib/hooks/use-task-data.ts', 'hook-use-task-data.txt')
applyFix('src/app/(dashboard)/tasks/my-tasks/page.tsx', 'my-tasks-page.txt')
console.log('')
console.log('Done. Now run:')
console.log('  git add -A')
console.log('  git commit -m "fix: My Tasks filter + logActivity TypeScript nulls"')
console.log('  git push')
console.log('')
