// ============================================================
// Podcast Module Deployment
// Run: node podcast-deploy.mjs
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

function patch(relPath, search, replace) {
  const target = path.resolve(relPath)
  let content = fs.readFileSync(target, 'utf-8')
  if (content.includes(replace)) {
    console.log('  [SKIP]  ' + relPath + ' (already patched)')
    return
  }
  if (!content.includes(search)) {
    console.log('  [WARN]  ' + relPath + ' (search string not found)')
    return
  }
  content = content.replace(search, replace)
  fs.writeFileSync(target, content, 'utf-8')
  console.log('  [PATCH] ' + relPath)
}

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' Podcast Module Deployment')
console.log('═══════════════════════════════════════════')
console.log('')

console.log('[1/5] Installing podcast types...')
apply('src/lib/types/podcast.ts', 'types-podcast.txt')

console.log('[2/5] Installing podcast data hook...')
apply('src/lib/hooks/use-podcast-data.ts', 'use-podcast-data.txt')

console.log('[3/5] Installing AI podcast API route...')
apply('src/app/api/ai/podcast/route.ts', 'api-podcast-route.txt')

console.log('[4/5] Installing media appearances page...')
apply('src/app/(dashboard)/media-appearances/page.tsx', 'media-appearances-page.txt')

console.log('[5/5] Moving Media Appearances to GROW in sidebar...')
// Move from OPERATE to GROW section
const sidebarPath = path.resolve('src/components/sidebar.tsx')
let sidebar = fs.readFileSync(sidebarPath, 'utf-8')

// Remove from current location (OPERATE section)
if (sidebar.includes("{ label: 'Media Appearances'")) {
  sidebar = sidebar.replace(/\s*\{ label: 'Media Appearances'[^}]+\},?\n?/g, '\n')
}

// Add to GROW section after Analytics
if (!sidebar.includes("media-appearances', icon: Mic")) {
  sidebar = sidebar.replace(
    "{ label: 'Analytics', href: '/analytics', icon: BarChart3, moduleKey: 'analytics' },",
    "{ label: 'Analytics', href: '/analytics', icon: BarChart3, moduleKey: 'analytics' },\n      { label: 'Media Appearances', href: '/media-appearances', icon: Mic, moduleKey: 'media_appearances' },"
  )
}

// Make sure Mic is imported
if (!sidebar.includes('Mic,') && !sidebar.includes('Mic }')) {
  sidebar = sidebar.replace(
    "} from 'lucide-react'",
    ", Mic } from 'lucide-react'"
  )
}

fs.writeFileSync(sidebarPath, sidebar, 'utf-8')
console.log('  [PATCH] src/components/sidebar.tsx')

console.log('')
console.log('═══════════════════════════════════════════')
console.log(' All files deployed!')
console.log('═══════════════════════════════════════════')
console.log('')
console.log('IMPORTANT: Run migration.sql in Supabase SQL Editor FIRST')
console.log('')
console.log('Then:')
console.log('  git add -A')
console.log('  git commit -m "feat: Media Appearances module with AI fill, feedback coach, voice library"')
console.log('  git push')
console.log('')
