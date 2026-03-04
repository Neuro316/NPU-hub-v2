// ============================================================
// Fix: AI voice continuous, search bar, create flow
// Run: node fix-ai-v2.mjs
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
console.log(' AI Voice Fix + Search Bar + Create Flow')
console.log('====================================')
console.log('')

// 1. AI Task Modal (continuous voice, better create flow)
console.log('[1/2] Updating AI task modal...')
apply('src/components/tasks/ai-task-modal.tsx', 'ai-task-modal-v2.txt')

// 2. Tasks page (search bar with AI search, assignee quick-add)
console.log('[2/2] Updating tasks page...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page-v3.txt')

console.log('')
console.log('=== All patches applied (0 errors) ===')
console.log('')
console.log('Next steps:')
console.log('  git add -A')
console.log('  git commit -m "fix: continuous voice, search bar with AI, task create flow"')
console.log('  git push')
console.log('')
