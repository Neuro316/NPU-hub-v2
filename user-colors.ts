// Deterministic color assignment per user name, with override support.
// Colors stored in org_settings under key "avatar_colors".

export const USER_COLORS = [
  { bg: '#DBEAFE', text: '#2563EB', label: 'Blue' },
  { bg: '#FCE7F3', text: '#DB2777', label: 'Pink' },
  { bg: '#D1FAE5', text: '#059669', label: 'Green' },
  { bg: '#FEF3C7', text: '#D97706', label: 'Amber' },
  { bg: '#EDE9FE', text: '#7C3AED', label: 'Violet' },
  { bg: '#FFEDD5', text: '#EA580C', label: 'Orange' },
  { bg: '#CFFAFE', text: '#0891B2', label: 'Cyan' },
  { bg: '#FEE2E2', text: '#DC2626', label: 'Red' },
  { bg: '#E0E7FF', text: '#4F46E5', label: 'Indigo' },
  { bg: '#ECFCCB', text: '#65A30D', label: 'Lime' },
  { bg: '#F5F3FF', text: '#6D28D9', label: 'Purple' },
  { bg: '#FFF7ED', text: '#C2410C', label: 'Deep Orange' },
] as const

export type ColorEntry = { bg: string; text: string; label: string }

// Overrides map: { "Cameron Allen": 4 } means index 4 (violet)
export type ColorOverrides = Record<string, number>

function hashName(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash) + name.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

export function getUserColor(name: string, overrides?: ColorOverrides): ColorEntry {
  if (!name) return USER_COLORS[0]
  if (overrides && name in overrides) {
    const idx = overrides[name]
    if (idx >= 0 && idx < USER_COLORS.length) return USER_COLORS[idx]
  }
  return USER_COLORS[hashName(name) % USER_COLORS.length]
}

export function getUserColorIndex(name: string, overrides?: ColorOverrides): number {
  if (!name) return 0
  if (overrides && name in overrides) return overrides[name]
  return hashName(name) % USER_COLORS.length
}

export function getUserInitials(name: string): string {
  if (!name) return '?'
  return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
}
