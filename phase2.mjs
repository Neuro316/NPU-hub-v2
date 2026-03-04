// ============================================================
// Phase 2: Project Architecture
// Run: node phase2.mjs
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
console.log(' Phase 2: Project Architecture')
console.log('═══════════════════════════════════════════')
console.log('')

console.log('[1/7] Updating task types...')
apply('src/lib/types/tasks.ts', 'types-tasks.txt')

console.log('[2/7] Updating task data hook...')
apply('src/lib/hooks/use-task-data.ts', 'hook-use-task-data.txt')

console.log('[3/7] Creating project manager modal...')
apply('src/components/tasks/project-manager.tsx', 'project-manager.txt')

console.log('[4/7] Updating tasks page (command bar UI)...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page-v5.txt')

console.log('[5/7] Updating task detail (project dropdown + brace fix)...')
apply('src/components/tasks/task-detail.tsx', 'task-detail.txt')

console.log('[6/7] Updating avatar color picker (ghost style)...')
apply('src/components/tasks/avatar-color-picker.tsx', 'avatar-color-picker.txt')

console.log('[7/7] AI task modal (latest v3)...')
apply('src/components/tasks/ai-task-modal.tsx', 'ai-task-modal-v3.txt')

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' All patches applied (0 errors)')
console.log('═══════════════════════════════════════════')
console.log('')
