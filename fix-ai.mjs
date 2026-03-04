// ============================================================
// Feature: AI Task Creator + Add Task Button
// Run: node fix-ai.mjs
// ============================================================
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let errors = 0

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
console.log(' AI Task Creator + Add Task Button')
console.log('====================================')
console.log('')

// 1. AI Task Creator API route
console.log('[1/3] Writing AI task-creator API route...')
apply('src/app/api/ai/task-creator/route.ts', 'task-creator-route.txt')

// 2. AI Task Modal component
console.log('[2/3] Writing AI task modal component...')
apply('src/components/tasks/ai-task-modal.tsx', 'ai-task-modal.txt')

// 3. Updated tasks page (Add Task + AI button wired)
console.log('[3/3] Updating tasks page...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page.txt')

console.log('')
if (errors > 0) {
  console.log('=== Completed with ' + errors + ' warning(s) ===')
} else {
  console.log('=== All patches applied (0 errors) ===')
}
console.log('')
console.log('IMPORTANT: Make sure ANTHROPIC_API_KEY is set in your')
console.log('Vercel environment variables (Settings > Environment Variables).')
console.log('')
console.log('Next steps:')
console.log('  npm run dev  (test locally)')
console.log('  git add -A')
console.log('  git commit -m "feat: AI task creator with voice input + Add Task button"')
console.log('  git push')
console.log('')
