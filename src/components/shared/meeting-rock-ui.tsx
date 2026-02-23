'use client'

// Simple class joiner
const cn = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(' ')

// ── Status Dot (8px colored circle) ──
export function StatusDot({ status, className }: { status: string; className?: string }) {
  const color = status === 'on_track' || status === 'complete' ? 'bg-green-500'
    : status === 'at_risk' ? 'bg-orange-500'
    : status === 'off_track' ? 'bg-red-500'
    : status === 'in_progress' ? 'bg-blue-500'
    : status === 'scheduled' ? 'bg-np-blue'
    : status === 'completed' ? 'bg-green-500'
    : 'bg-gray-400'

  return <div className={cn('status-dot', color, className)} />
}

// ── Progress Bar (auto-color by percentage) ──
export function ProgressBar({ pct, height = 8, className }: { pct: number; height?: number; className?: string }) {
  const clamped = Math.min(Math.max(pct, 0), 100)
  const color = clamped >= 100 ? 'bg-green-500'
    : clamped >= 67 ? 'bg-teal'
    : clamped >= 34 ? 'bg-gold'
    : 'bg-orange-500'

  return (
    <div className={cn('flex-1 bg-border-light overflow-hidden', className)}
      style={{ height, borderRadius: height / 2 }}>
      <div className={cn(color, 'h-full transition-all duration-500')}
        style={{ width: `${clamped}%`, borderRadius: height / 2 }} />
    </div>
  )
}

// ── Badge Pill (colored label) ──
export function BadgePill({
  text, color, bgColor, className
}: { text: string; color: string; bgColor?: string; className?: string }) {
  return (
    <span className={cn('badge-pill', className)}
      style={{
        color,
        background: bgColor || (color + '1A'),
        letterSpacing: 0.4,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        lineHeight: '18px',
      }}>
      {text}
    </span>
  )
}

// ── Priority Badge ──
const PRIORITY_MAP: Record<string, { color: string; bg: string }> = {
  low: { color: '#9CA3AF', bg: '#F3F4F6' },
  medium: { color: '#386797', bg: '#DBEAFE' },
  high: { color: '#F59E0B', bg: '#FEF3C7' },
  urgent: { color: '#DC2626', bg: '#FEE2E2' },
}

export function PriorityBadge({ priority }: { priority: string }) {
  const { color, bg } = PRIORITY_MAP[priority] || PRIORITY_MAP.medium
  return <BadgePill text={priority} color={color} bgColor={bg} />
}

// ── Avatar (initials circle) ──
const AVATAR_COLORS = ['#2A9D8F', '#C4704B', '#D4A54A', '#7C3AED', '#2563EB', '#E4405F', '#EA580C', '#386797']

export function Avatar({ initials, size = 28, color }: { initials: string; size?: number; color?: string }) {
  const autoColor = color || AVATAR_COLORS[initials.charCodeAt(0) % AVATAR_COLORS.length]
  return (
    <div className="flex items-center justify-center flex-shrink-0 rounded-full text-white font-bold"
      style={{ width: size, height: size, background: autoColor, fontSize: size * 0.36 }}>
      {initials}
    </div>
  )
}

// ── Avatar Stack (overlapping circles, max N) ──
export function AvatarStack({ list, max = 4 }: { list: { initials: string; color?: string }[]; max?: number }) {
  const shown = list.slice(0, max)
  const overflow = list.length - max

  return (
    <div className="flex items-center">
      {shown.map((a, i) => (
        <div key={i} className="rounded-full border-2 border-white" style={{ marginLeft: i ? -7 : 0, zIndex: max - i }}>
          <Avatar initials={a.initials} size={24} color={a.color} />
        </div>
      ))}
      {overflow > 0 && <span className="text-[9px] text-gray-400 ml-1 font-semibold">+{overflow}</span>}
    </div>
  )
}
