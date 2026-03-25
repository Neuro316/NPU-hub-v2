import {
  LayoutDashboard, Route, CheckSquare, Brain, FileText, Lightbulb,
  Users, Target, Megaphone, Radio, Calendar, BarChart3, Settings,
  BookOpen, Mic, TicketCheck, Image, Rocket, Contact2, DollarSign, ClipboardList, Package,
} from 'lucide-react'

/* ───────────────────────────────────────────────────────────
   Shared nav configuration — used by Sidebar and Settings
   ─────────────────────────────────────────────────────────── */

export interface NavItem {
  label: string
  href: string
  icon: any
  moduleKey: string
}

export interface NavCategory {
  id: string
  label: string
  collapsible: boolean
  items: NavItem[]
}

export const navCategories: NavCategory[] = [
  {
    id: 'home',
    label: '',
    collapsible: false,
    items: [
      { label: 'Dashboard', href: '/', icon: LayoutDashboard, moduleKey: 'dashboard' },
    ],
  },
  {
    id: 'grow',
    label: 'GROW',
    collapsible: true,
    items: [
      { label: 'CRM', href: '/crm', icon: Contact2, moduleKey: 'crm' },
      { label: 'Campaigns', href: '/campaigns', icon: Megaphone, moduleKey: 'campaigns' },
      { label: 'Media & Affiliates', href: '/media-affiliates', icon: Radio, moduleKey: 'media_affiliates' },
      { label: 'ICP Profiles', href: '/icps', icon: Users, moduleKey: 'icps' },
      { label: 'Analytics', href: '/analytics', icon: BarChart3, moduleKey: 'analytics' },
      { label: 'Media Appearances', href: '/media-appearances', icon: Mic, moduleKey: 'media_appearances' },
    ],
  },
  {
    id: 'create',
    label: 'CREATE',
    collapsible: true,
    items: [
      { label: 'Social Media', href: '/social', icon: Target, moduleKey: 'social' },
      { label: 'Media Library', href: '/media', icon: Image, moduleKey: 'media' },
      { label: 'Calendar', href: '/calendar', icon: Calendar, moduleKey: 'calendar' },
      { label: 'ShipIt Journal', href: '/shipit', icon: Rocket, moduleKey: 'shipit' },
      { label: 'Ideas', href: '/ideas', icon: Lightbulb, moduleKey: 'ideas' },
      { label: 'Company Library', href: '/library', icon: BookOpen, moduleKey: 'library' },
    ],
  },
  {
    id: 'operate',
    label: 'OPERATE',
    collapsible: true,
    items: [
      { label: 'Meetings', href: '/meetings', icon: Calendar, moduleKey: 'meetings' },
      { label: 'Rocks', href: '/rocks', icon: Target, moduleKey: 'rocks' },
      { label: 'My Tasks', href: '/tasks/my-tasks', icon: CheckSquare, moduleKey: 'tasks' },
      { label: 'Task Manager', href: '/tasks', icon: CheckSquare, moduleKey: 'tasks' },
      { label: 'Client Tasks', href: '/crm/tasks', icon: ClipboardList, moduleKey: 'tasks' },
      { label: 'Journey Builder', href: '/journeys', icon: Route, moduleKey: 'journeys' },
      { label: 'SOPs', href: '/sops', icon: FileText, moduleKey: 'sops' },
      { label: 'Support Tickets', href: '/tickets', icon: TicketCheck, moduleKey: 'tickets' },
      { label: 'Equipment', href: '/equipment', icon: Package, moduleKey: 'equipment' },
    ],
  },
  {
    id: 'intelligence',
    label: 'INTELLIGENCE',
    collapsible: false,
    items: [
      { label: 'AI Advisory', href: '/advisory', icon: Brain, moduleKey: 'advisory' },
    ],
  },
  {
    id: 'finance',
    label: 'FINANCE',
    collapsible: true,
    items: [
      { label: 'AI CFO', href: '/finance', icon: Brain, moduleKey: 'finance_suite' },
      { label: 'NP Financial', href: '/financial/np', icon: DollarSign, moduleKey: 'np_financial' },
    ],
  },
  {
    id: 'admin',
    label: 'ADMIN',
    collapsible: true,
    items: [
      { label: 'Platform Advisor', href: '/platform-advisor', icon: Brain, moduleKey: 'platform_advisor' },
      { label: 'Settings', href: '/settings', icon: Settings, moduleKey: 'settings' },
    ],
  },
]

/* ─── Sidebar ordering ─── */

export interface SidebarOrder {
  categories: string[]
  items: Record<string, string[]>
}

const PINNED_TOP = ['home']
const PINNED_BOTTOM = ['admin']
export const REORDERABLE_IDS = ['grow', 'create', 'operate', 'intelligence', 'finance']

/**
 * Sort navCategories + their items by a saved SidebarOrder.
 * Pins home to top and admin to bottom regardless of saved order.
 * Items/categories not in saved order sort to the end.
 */
export function applySidebarOrder(
  categories: NavCategory[],
  order: SidebarOrder | null
): NavCategory[] {
  if (!order) return categories

  const pinTop = categories.filter(c => PINNED_TOP.includes(c.id))
  const pinBottom = categories.filter(c => PINNED_BOTTOM.includes(c.id))
  const reorderable = categories.filter(c => REORDERABLE_IDS.includes(c.id))

  // Sort reorderable categories
  let sortedMiddle: NavCategory[]
  if (order.categories?.length) {
    const orderMap = new Map(order.categories.map((id, i) => [id, i]))
    sortedMiddle = [...reorderable].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? 999
      const bi = orderMap.get(b.id) ?? 999
      return ai - bi
    })
  } else {
    sortedMiddle = reorderable
  }

  // Sort items within each category
  return [...pinTop, ...sortedMiddle, ...pinBottom].map(cat => {
    const itemOrder = order.items?.[cat.id]
    if (!itemOrder?.length) return cat

    const hrefMap = new Map(itemOrder.map((href, i) => [href, i]))
    const sortedItems = [...cat.items].sort((a, b) => {
      const ai = hrefMap.get(a.href) ?? 999
      const bi = hrefMap.get(b.href) ?? 999
      return ai - bi
    })
    return { ...cat, items: sortedItems }
  })
}
