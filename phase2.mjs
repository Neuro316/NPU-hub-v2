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

console.log('[1/5] Updating task types (Project, SavedView)...')
apply('src/lib/types/tasks.ts', 'types-tasks.txt')

console.log('[2/5] Updating task data hook (project + views CRUD)...')
apply('src/lib/hooks/use-task-data.ts', 'hook-use-task-data.txt')

console.log('[3/5] Creating project manager modal...')
apply('src/components/tasks/project-manager.tsx', 'project-manager.txt')

console.log('[4/5] Updating tasks page (project nav, saved views, filters)...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page-v5.txt')

console.log('[5/5] AI task modal (latest v3)...')
apply('src/components/tasks/ai-task-modal.tsx', 'ai-task-modal-v3.txt')

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' All patches applied (0 errors)')
console.log('═══════════════════════════════════════════')
console.log('')
console.log('IMPORTANT: Run the SQL migration in Supabase SQL Editor FIRST:')
console.log('  File: migration.sql')
console.log('')
console.log('Then deploy:')
console.log('  git add -A')
console.log('  git commit -m "feat: Phase 2 - project architecture, saved views, priority filters"')
console.log('  git push')
console.log('')
