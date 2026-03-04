// ============================================================
// Fix: AI voice cuts off + task not saving to column
// Run: node fix-ai-v3.mjs
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
console.log(' Fix: AI Voice + Task Save')
console.log('====================================')
console.log('')

console.log('[1/1] Updating AI task modal...')
apply('src/components/tasks/ai-task-modal.tsx', 'ai-task-modal-v3.txt')

console.log('')
console.log('=== All patches applied ===')
console.log('')
console.log('Next steps:')
console.log('  git add -A')
console.log('  git commit -m "fix: AI voice persistent recording, task save to column"')
console.log('  git push')
console.log('')
