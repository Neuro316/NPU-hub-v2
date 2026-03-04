// ============================================================
// NPU Task Manager — Phase 1 Patch Script
// Run: node patch-phase1.mjs
// ============================================================
// BEFORE RUNNING:
// 1. Run step1-additive.sql in Supabase SQL Editor
// 2. Run step2-rls-swap.sql in Supabase SQL Editor
// 3. cd into your npu-hub-fresh root directory
// 4. All .txt content files must be in the same directory as this script
// ============================================================

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

let errors = 0

function read(name) {
  const p = path.join(__dirname, name)
  if (!fs.existsSync(p)) {
    console.error(`  [MISSING] ${name} — skipping`)
    errors++
    return null
  }
  return fs.readFileSync(p, 'utf-8')
}

function write(relPath, content) {
  const full = path.resolve(relPath)
  const dir = path.dirname(full)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(full, content, 'utf-8')
  console.log(`  [WRITE] ${relPath}`)
}

function patchReplace(relPath, search, replacement, label) {
  const full = path.resolve(relPath)
  if (!fs.existsSync(full)) {
    console.error(`  [MISSING] ${relPath} — cannot patch`)
    errors++
    return false
  }
  let content = fs.readFileSync(full, 'utf-8')
  if (!content.includes(search)) {
    console.error(`  [NOT FOUND] search string in ${relPath} for: ${label}`)
    errors++
    return false
  }
  content = content.replace(search, replacement)
  fs.writeFileSync(full, content, 'utf-8')
  console.log(`  [PATCH]  ${relPath} — ${label}`)
  return true
}

console.log('')
console.log('====================================')
console.log(' NPU Task Manager — Phase 1 Patch')
console.log('====================================')
console.log(' Features:')
console.log('   1. Quick-assign on task creation')
console.log('   2. Subtasks & checklists')
console.log('   3. My Tasks inbox')
console.log('   4. Activity feed')
console.log('   5. Personal (private) tasks')
console.log('====================================')
console.log('')

// 1. Types
console.log('[1/7] Updating types...')
const types = read('types-tasks.txt')
if (types) write('src/lib/types/tasks.ts', types)

// 2. Hook
console.log('[2/7] Updating use-task-data hook...')
const hook = read('hook-use-task-data.txt')
if (hook) write('src/lib/hooks/use-task-data.ts', hook)

// 3. Kanban Column (quick-assign + personal toggle)
console.log('[3/7] Updating kanban-column...')
const kanban = read('kanban-column.txt')
if (kanban) write('src/components/tasks/kanban-column.tsx', kanban)

// 4. Task Card (subtask progress + lock icon)
console.log('[4/7] Updating task-card...')
const card = read('task-card.txt')
if (card) write('src/components/tasks/task-card.tsx', card)

// 5. Task Detail (subtasks + activity + private indicator)
console.log('[5/7] Updating task-detail...')
const detail = read('task-detail.txt')
if (detail) write('src/components/tasks/task-detail.tsx', detail)

// 6. Tasks page (pass new props)
console.log('[6/7] Updating tasks page...')
const tasksPage = read('tasks-page.txt')
if (tasksPage) write('src/app/(dashboard)/tasks/page.tsx', tasksPage)

// 7. My Tasks page (new)
console.log('[7/7] Creating My Tasks page...')
const myTasks = read('my-tasks-page.txt')
if (myTasks) write('src/app/(dashboard)/tasks/my-tasks/page.tsx', myTasks)

// 8. Sidebar — add "My Tasks" link
console.log('[+] Patching sidebar...')
patchReplace(
  'src/components/sidebar.tsx',
  "{ label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },",
  "{ label: 'My Tasks', href: '/tasks/my-tasks', icon: CheckSquare, moduleKey: 'tasks' },\n      { label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },",
  'Add My Tasks to sidebar'
)

console.log('')
if (errors > 0) {
  console.log(`=== Completed with ${errors} warning(s) ===`)
  console.log('Check the warnings above — some patches may need manual application.')
} else {
  console.log('=== Phase 1 patch complete (0 errors) ===')
}
console.log('')
console.log('Next steps:')
console.log('  1. Run step1-additive.sql in Supabase SQL Editor (tables + columns)')
console.log('  2. Run step2-rls-swap.sql in Supabase SQL Editor (privacy policies)')
console.log('  3. npm run dev — verify locally')
console.log('  4. git add -A && git commit -m "feat: Phase 1 task manager — quick-assign, subtasks, my-tasks, activity, personal tasks" && git push')
console.log('')
