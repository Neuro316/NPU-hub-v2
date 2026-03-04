// ============================================================
// Fix: User colors + My Tasks filter + logActivity nulls
// Run: node fix-all.mjs
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
console.log('Applying fixes...')
apply('src/lib/user-colors.ts', 'user-colors.ts')
apply('src/components/tasks/task-card.tsx', 'task-card.txt')
apply('src/lib/hooks/use-task-data.ts', 'hook-use-task-data.txt')
apply('src/app/(dashboard)/tasks/my-tasks/page.tsx', 'my-tasks-page.txt')
console.log('')
console.log('Done. Now run:')
console.log('  git add -A')
console.log('  git commit -m "fix: user colors, My Tasks filter, logActivity nulls"')
console.log('  git push')
console.log('')
