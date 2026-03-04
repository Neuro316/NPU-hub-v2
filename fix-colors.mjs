// ============================================================
// Fix: Color picker + Client Tasks sidebar + logActivity nulls
// Run: node fix-colors.mjs
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

function patch(relPath, search, replacement, label) {
  const full = path.resolve(relPath)
  if (!fs.existsSync(full)) { console.error('  [MISSING] ' + relPath); errors++; return }
  let content = fs.readFileSync(full, 'utf-8')
  if (!content.includes(search)) { console.error('  [NOT FOUND] ' + label); errors++; return }
  content = content.replace(search, replacement)
  fs.writeFileSync(full, content, 'utf-8')
  console.log('  [PATCH]  ' + relPath + ' — ' + label)
}

console.log('')
console.log('====================================')
console.log(' Color Picker + Client Tasks Sidebar')
console.log('====================================')
console.log('')

// 1. User colors utility (with overrides support)
console.log('[1/7] Writing user-colors utility...')
apply('src/lib/user-colors.ts', 'user-colors.ts')

// 2. Avatar color picker component
console.log('[2/7] Writing color picker component...')
apply('src/components/tasks/avatar-color-picker.tsx', 'avatar-color-picker.txt')

// 3. Task card (with colorOverrides prop)
console.log('[3/7] Updating task card...')
apply('src/components/tasks/task-card.tsx', 'task-card.txt')

// 4. Kanban column (pass colorOverrides)
console.log('[4/7] Updating kanban column...')
apply('src/components/tasks/kanban-column.tsx', 'kanban-column.txt')

// 5. Tasks page (color picker + load/save)
console.log('[5/7] Updating tasks page...')
apply('src/app/(dashboard)/tasks/page.tsx', 'tasks-page.txt')

// 6. My Tasks page (color overrides + assignee avatars)
console.log('[6/7] Updating my-tasks page...')
apply('src/app/(dashboard)/tasks/my-tasks/page.tsx', 'my-tasks-page.txt')

// 7. Hook (logActivity null fixes)
console.log('[7/7] Updating use-task-data hook...')
apply('src/lib/hooks/use-task-data.ts', 'hook-use-task-data.txt')

// 8. Sidebar: add Client Tasks under Task Manager
console.log('[+] Patching sidebar...')
patch(
  'src/components/sidebar.tsx',
  "{ label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },",
  "{ label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },\n      { label: 'Client Tasks', href: '/crm/tasks', icon: ClipboardList, moduleKey: 'tasks' },",
  'Add Client Tasks to sidebar'
)

console.log('')
if (errors > 0) {
  console.log('=== Completed with ' + errors + ' warning(s) ===')
} else {
  console.log('=== All patches applied (0 errors) ===')
}
console.log('')
console.log('Next steps:')
console.log('  git add -A')
console.log('  git commit -m "feat: avatar color picker, client tasks sidebar"')
console.log('  git push')
console.log('')
