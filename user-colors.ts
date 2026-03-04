// Deterministic color assignment per user name.
// Each person always gets the same color across the entire app.

const USER_COLORS = [
  { bg: '#DBEAFE', text: '#2563EB' },   // blue
  { bg: '#FCE7F3', text: '#DB2777' },   // pink
  { bg: '#D1FAE5', text: '#059669' },   // green
  { bg: '#FEF3C7', text: '#D97706' },   // amber
  { bg: '#EDE9FE', text: '#7C3AED' },   // violet
  { bg: '#FFEDD5', text: '#EA580C' },   // orange
  { bg: '#CFFAFE', text: '#0891B2' },   // cyan
  { bg: '#FEE2E2', text: '#DC2626' },   // red
  { bg: '#E0E7FF', text: '#4F46E5' },   // indigo
  { bg: '#ECFCCB', text: '#65A30D' },   // lime
  { bg: '#F5F3FF', text: '#6D28D9' },   // purple
  { bg: '#FFF7ED', text: '#C2410C' },   // deep orange
] as const

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function getUserColor(name: string): { bg: string; text: string } {
  if (!name) return USER_COLORS[0]
  return USER_COLORS[hashName(name) % USER_COLORS.length]
}

export function getUserInitials(name: string): string {
  if (!name) return '?'
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}
