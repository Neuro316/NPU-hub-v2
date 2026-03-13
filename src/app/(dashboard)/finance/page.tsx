'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { usePermissions } from '@/lib/hooks/use-permissions'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Shield, DollarSign, TrendingUp, TrendingDown, BarChart3,
  PieChart, Wallet, Users, Plus, X, Pencil, Trash2, Download,
  RefreshCw, ChevronLeft, ChevronRight, Search, CheckCircle2,
  Clock, AlertTriangle, FileText, Settings, Zap, Building,
  ArrowUpRight, ArrowDownRight, Brain, Activity, Filter, Tag, Lock,
  Target, MessageSquare, Lightbulb, TrendingUp as TrendUp, Calendar, Send, Flame, LifeBuoy,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────
interface OrgSummary  { id: string; name: string; slug: string }
interface FinSettings {
  target_gross_margin: number; target_net_margin: number
  fiscal_year_start_month: number; currency: string
  target_monthly_revenue: number; target_net_margin_pct: number
  avg_cac: number; avg_ltv: number; avg_churn_pct: number
  monthly_burn_rate: number; cash_on_hand: number
  // Balance sheet inputs
  accounts_receivable: number; accounts_payable: number
  deferred_revenue: number; short_term_debt: number
  long_term_debt: number; equipment_value: number
  // EBITDA adjustments
  monthly_depreciation: number; monthly_interest: number; monthly_amortization: number
}
interface GoalObligation { id: string; label: string; amount: number; due_date: string; notes: string }
interface CapTableEntry {
  id: string
  name: string
  role: 'founder'|'investor'|'employee'|'advisor'|'safe'|'note'
  share_class: 'common'|'preferred'|'option'|'safe'|'convertible_note'|'warrant'
  shares: number
  ownership_pct: number
  investment: number
  instrument: string
  conversion_discount: number
  conversion_cap: number
  monthly_payment: number
  notes: string
}
interface CoachMessage { role: 'user' | 'assistant'; content: string }
interface Product     { id: string; name: string; category: string; price: number; sort_order: number }
interface ExpCat      { id: string; group_name: string; name: string; is_cogs: boolean; sort_order: number }
interface FinClient   { id: string; name: string; email: string; phone: string; notes: string; contract_value: number }
interface Income      {
  id: string; txn_date: string; period_month: string
  client_name: string | null; product_name: string | null
  amount: number; status: 'paid'|'pending'|'refunded'|'disputed'
  source: 'manual'|'stripe'|'np_platform'|'investment'; stripe_payment_id: string | null
  income_category: string | null
  notes: string | null
}
interface Expense {
  id: string; txn_date: string; period_month: string; vendor: string
  category_name: string | null; group_name: string | null; is_cogs: boolean
  amount: number; status: 'paid'|'pending'|'overdue'; recurring: boolean; notes: string | null
}

// ─── Utils ────────────────────────────────────────────────────────────
const $$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 }).format(n || 0)
const $c = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n || 0)
const fmtP  = (n: number) => `${(n || 0).toFixed(1)}%`
const fmtDate = (d: string) => {
  if (!d) return ''
  try { return new Date(d + (d.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }
  catch { return d }
}
const curMonth = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const prevMo = (m: string) => {
  const [yr, mo] = m.split('-').map(Number)
  const d = new Date(yr, mo - 2, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const nextMo = (m: string) => {
  const [yr, mo] = m.split('-').map(Number)
  const d = new Date(yr, mo, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const moLabel = (m: string) => {
  const [yr, mo] = m.split('-')
  return new Date(parseInt(yr), parseInt(mo) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// ─── Sub-components ──────────────────────────────────────────────────
function Stat({ label, value, sub, color = 'text-np-dark', up, tip }: {
  label: string; value: string; sub?: string; color?: string; up?: boolean | null; tip?: string
}) {
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">{label}{tip && <InfoTip text={tip} />}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      {sub && (
        <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
          {up === true  && <ArrowUpRight  className="w-3 h-3 text-emerald-500" />}
          {up === false && <ArrowDownRight className="w-3 h-3 text-red-500" />}
          {sub}
        </p>
      )}
    </div>
  )
}

function MBar({ label, actual, target, color }: { label: string; actual: number; target: number; color: string }) {
  const pct = Math.min(100, Math.max(0, actual))
  const ok  = actual >= target
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-1">
        <span className="font-medium text-np-dark">{label}</span>
        <span className={ok ? 'text-emerald-600 font-semibold' : 'text-amber-600 font-semibold'}>
          {fmtP(actual)} <span className="text-gray-400 font-normal">/ {fmtP(target)} target</span>
        </span>
      </div>
      <div className="relative h-2.5 bg-gray-100 rounded-full overflow-visible">
        <div className="absolute h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: color }} />
        <div className="absolute top-0 bottom-0 border-l-2 border-dashed border-gray-400 z-10" style={{ left: `${Math.min(99, target)}%` }} />
      </div>
    </div>
  )
}

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="relative inline-flex items-center ml-1" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400 flex items-center justify-center text-[9px] font-bold cursor-help leading-none hover:border-np-blue hover:text-np-blue transition-colors select-none">i</span>
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-np-dark text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-xl z-50 pointer-events-none">
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-np-dark" />
        </span>
      )}
    </span>
  )
}

function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`bg-white rounded-2xl shadow-2xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'}`}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-np-dark">{title}</h3>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-6 max-h-[80vh] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}

function FInput({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 mb-1 block">{label}</span>
      <input {...p} className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue ${p.className || ''}`} />
    </label>
  )
}
function FSelect({ label, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-gray-600 mb-1 block">{label}</span>
      <select {...p} className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue ${p.className || ''}`}>
        {children}
      </select>
    </label>
  )
}
function Btn({ children, variant = 'primary', size = 'sm', className = '', ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'sm'|'xs'
}) {
  const base = 'inline-flex items-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 cursor-pointer'
  const sz   = size === 'xs' ? 'px-2 py-1.5 text-xs' : 'px-3 py-2 text-sm'
  const v    = { primary: 'bg-np-blue text-white hover:bg-np-blue/90', secondary: 'bg-gray-100 text-np-dark hover:bg-gray-200', ghost: 'text-gray-500 hover:text-np-dark hover:bg-gray-100', danger: 'text-red-600 hover:bg-red-50 hover:text-red-700' }[variant]
  return <button {...p} className={`${base} ${sz} ${v} ${className}`}>{children}</button>
}

// ─── Main Page ────────────────────────────────────────────────────────
export default function FinancePage() {
  const { role } = usePermissions()
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const isSuperAdmin = role === 'super_admin'

  // ── Org resolution: follows master org switcher in sidebar ─────────
  const selectedOrg = currentOrg as OrgSummary | null
  const isNP = useMemo(() => selectedOrg?.slug?.toLowerCase().includes('neuro') || selectedOrg?.slug?.toLowerCase().includes('progeny'), [selectedOrg])
  const orgColor = isNP ? '#386797' : '#2A9D8F'

  // ── State ─────────────────────────────────────────────────────────
  const [tab,      setTab]     = useState<'dashboard'|'income'|'expenses'|'clients'|'products'|'reports'|'settings'|'ai-cfo'|'goals'|'coach'|'projections'|'metrics'|'balance-sheet'|'unit-economics'|'cap-table'>('ai-cfo')
  const [month,    setMonth]   = useState(curMonth)
  const [loading,  setLoading] = useState(false)
  const [syncing,  setSyncing] = useState(false)
  const [search,   setSearch]  = useState('')

  const [income,     setIncome]     = useState<Income[]>([])
  const [expenses,   setExpenses]   = useState<Expense[]>([])
  const [clients,    setClients]    = useState<FinClient[]>([])
  const [products,   setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<ExpCat[]>([])
  const [settings,   setSettings]   = useState<FinSettings>({ target_gross_margin: 60, target_net_margin: 30, fiscal_year_start_month: 1, currency: 'usd', target_monthly_revenue: 0, target_net_margin_pct: 30, avg_cac: 0, avg_ltv: 0, avg_churn_pct: 0, monthly_burn_rate: 0, cash_on_hand: 0, accounts_receivable: 0, accounts_payable: 0, deferred_revenue: 0, short_term_debt: 0, long_term_debt: 0, equipment_value: 0, monthly_depreciation: 0, monthly_interest: 0, monthly_amortization: 0 })
  const [aiText,     setAiText]     = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)
  const [obligations,   setObligations]   = useState<GoalObligation[]>([])
  const [coachMsgs,     setCoachMsgs]     = useState<CoachMessage[]>([])
  const [coachInput,    setCoachInput]    = useState('')
  const [coachLoading,  setCoachLoading]  = useState(false)
  const coachEndRef = useRef<HTMLDivElement>(null)
  const [capTable, setCapTable] = useState<CapTableEntry[]>([])
  const [capEditing, setCapEditing] = useState<string | null>(null)

  // Modal states
  const [showIncomeModal,  setShowIncomeModal]  = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showClientModal,  setShowClientModal]  = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)
  const [editIncome,       setEditIncome]       = useState<Income | null>(null)
  const [editExpense,      setEditExpense]       = useState<Expense | null>(null)
  const [editClient,       setEditClient]        = useState<FinClient | null>(null)
  const [editProduct,      setEditProduct]       = useState<Product | null>(null)

  // ── Load data ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (!selectedOrg) return
    setLoading(true)
    try {
      const orgId = selectedOrg.id
      const [incRes, expRes, cliRes, prodRes, catRes, setRes] = await Promise.all([
        fetch(`/api/finance/income?org_id=${orgId}&month=${month}`),
        fetch(`/api/finance/expenses?org_id=${orgId}&month=${month}`),
        fetch(`/api/finance/clients?org_id=${orgId}`),
        fetch(`/api/finance/products?org_id=${orgId}&type=products`),
        fetch(`/api/finance/products?org_id=${orgId}&type=categories`),
        fetch(`/api/finance/settings?org_id=${orgId}`),
      ])
      const [incData, expData, cliData, prodData, catData, setData] = await Promise.all([
        incRes.json(), expRes.json(), cliRes.json(), prodRes.json(), catRes.json(), setRes.json()
      ])
      setIncome(incData.income || [])
      setExpenses(expData.expenses || [])
      setClients(cliData.clients || [])
      setProducts(prodData.products || [])
      setCategories(catData.categories || [])
      if (setData.settings) {
        setSettings(setData.settings)
        if (setData.settings.cap_table_json) {
          try { setCapTable(JSON.parse(setData.settings.cap_table_json)) } catch {}
        }
      }

      // Load cached AI insight
      const aiRes = await fetch(`/api/finance/ai?org_id=${orgId}&period_month=${month}`)
      const aiData = await aiRes.json()
      if (aiData.insight) setAiText(aiData.insight)
      else setAiText('')
    } finally {
      setLoading(false)
    }
  }, [selectedOrg, month])

  useEffect(() => { loadData() }, [loadData])

  // ── Sync NP platform payments ──────────────────────────────────────
  const syncNP = useCallback(async () => {
    if (!selectedOrg || !isNP) return
    setSyncing(true)
    try {
      const res = await fetch('/api/finance/np-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: selectedOrg.id, month }),
      })
      const data = await res.json()
      if (data.synced > 0) await loadData()
      alert(`Synced ${data.synced} new platform payments. ${data.already_synced || 0} already in ledger.`)
    } catch (err: any) {
      alert('Sync error: ' + err.message)
    } finally {
      setSyncing(false)
    }
  }, [selectedOrg, isNP, month, loadData])

  // ── Derived metrics ────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const paidIncome    = income.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0)
    const pendingIncome = income.filter(i => i.status === 'pending').reduce((s, i) => s + i.amount, 0)
    const cogsTotal     = expenses.filter(e => e.is_cogs && e.status !== 'overdue').reduce((s, e) => s + e.amount, 0)
    const totalExp      = expenses.reduce((s, e) => s + e.amount, 0)
    const grossProfit   = paidIncome - cogsTotal
    const netIncome     = paidIncome - totalExp
    const grossMargin   = paidIncome > 0 ? (grossProfit / paidIncome) * 100 : 0
    const netMargin     = paidIncome > 0 ? (netIncome / paidIncome) * 100 : 0

    // Group expenses by category group
    const byGroup: Record<string, number> = {}
    expenses.forEach(e => { const g = e.group_name || 'Other'; byGroup[g] = (byGroup[g] || 0) + e.amount })
    const topGroups = Object.entries(byGroup)
      .sort((a, b) => b[1] - a[1])
      .map(([group, total]) => ({ group, total }))

    // Group income by product
    const byProduct: Record<string, { total: number; count: number }> = {}
    income.filter(i => i.status === 'paid').forEach(i => {
      const k = i.product_name || 'Other'
      if (!byProduct[k]) byProduct[k] = { total: 0, count: 0 }
      byProduct[k].total += i.amount
      byProduct[k].count += 1
    })
    const topProducts = Object.entries(byProduct)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, d]) => ({ name, ...d }))

    // EBITDA = Net Income + Interest + Taxes (0) + Depreciation + Amortization
    // We use settings for D&A and interest since they're non-cash or financing items
    const contribMargin    = paidIncome - cogsTotal  // same as gross profit here (variable = cogs)
    const contribMarginPct = paidIncome > 0 ? (contribMargin / paidIncome) * 100 : 0

    // Separate operating vs investment income
    const investmentIncome = income.filter(i => (i as any).income_category === 'investment' && i.status === 'paid').reduce((s, i) => s + i.amount, 0)
    const operatingIncome  = paidIncome - investmentIncome

    return { paidIncome, pendingIncome, cogsTotal, totalExp, grossProfit, netIncome, grossMargin, netMargin, topGroups, topProducts, contribMargin, contribMarginPct, investmentIncome, operatingIncome }
  }, [income, expenses])

  // ── Filtered views ─────────────────────────────────────────────────
  const filteredIncome   = useMemo(() => income.filter(i => !search || [i.client_name, i.product_name, i.notes].join(' ').toLowerCase().includes(search.toLowerCase())), [income, search])
  const filteredExpenses = useMemo(() => expenses.filter(e => !search || [e.vendor, e.category_name, e.notes].join(' ').toLowerCase().includes(search.toLowerCase())), [expenses, search])
  const filteredClients  = useMemo(() => clients.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())), [clients, search])

  // ── Group expenses for display ─────────────────────────────────────
  const expensesByGroup = useMemo(() => {
    const grps: Record<string, Expense[]> = {}
    filteredExpenses.forEach(e => { const g = e.group_name || 'Other'; if (!grps[g]) grps[g] = []; grps[g].push(e) })
    return Object.entries(grps).sort((a, b) => b[1].reduce((s, e) => s + e.amount, 0) - a[1].reduce((s, e) => s + e.amount, 0))
  }, [filteredExpenses])

  // ── CRUD operations ───────────────────────────────────────────────
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>('')

  async function doSave(url: string, method: string, body: Record<string, any>): Promise<boolean> {
    setSaving(true)
    setSaveError('')
    try {
      if (!selectedOrg) {
        setSaveError('No organization selected — please select an org from the top menu and try again.')
        return false
      }
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (res.ok) { await loadData(); return true }
      let msg = `HTTP ${res.status}`
      try { const e = await res.json(); msg = e.error || msg } catch {}
      setSaveError(msg)
      return false
    } catch (err: any) {
      setSaveError(err.message || 'Network error')
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveIncome(data: Record<string, any>) {
    const method = editIncome ? 'PUT' : 'POST'
    const body   = editIncome ? { id: editIncome.id, org_id: selectedOrg?.id, ...data } : { org_id: selectedOrg?.id, ...data }
    const ok = await doSave('/api/finance/income', method, body)
    if (ok) { setShowIncomeModal(false); setEditIncome(null) }
  }

  async function deleteIncome(id: string) {
    if (!selectedOrg || !confirm('Delete this income record?')) return
    await fetch(`/api/finance/income?id=${id}&org_id=${selectedOrg.id}`, { method: 'DELETE' })
    await loadData()
  }

  async function saveExpense(data: Record<string, any>) {
    const method = editExpense ? 'PUT' : 'POST'
    const body   = editExpense ? { id: editExpense.id, org_id: selectedOrg?.id, ...data } : { org_id: selectedOrg?.id, ...data }
    const ok = await doSave('/api/finance/expenses', method, body)
    if (ok) { setShowExpenseModal(false); setEditExpense(null) }
  }

  async function deleteExpense(id: string) {
    if (!selectedOrg || !confirm('Delete this expense?')) return
    await fetch(`/api/finance/expenses?id=${id}&org_id=${selectedOrg.id}`, { method: 'DELETE' })
    await loadData()
  }

  async function saveClient(data: Record<string, any>) {
    const method = editClient ? 'PUT' : 'POST'
    const body   = editClient ? { id: editClient.id, org_id: selectedOrg?.id, ...data } : { org_id: selectedOrg?.id, ...data }
    const ok = await doSave('/api/finance/clients', method, body)
    if (ok) { setShowClientModal(false); setEditClient(null) }
  }

  async function saveProduct(data: Record<string, any>) {
    const method = editProduct ? 'PUT' : 'POST'
    const body   = editProduct ? { id: editProduct.id, org_id: selectedOrg?.id, ...data } : { org_id: selectedOrg?.id, ...data }
    const ok = await doSave('/api/finance/products', method, body)
    if (ok) { setShowProductModal(false); setEditProduct(null) }
  }

  async function saveSettings(data: Partial<FinSettings>) {
    if (!selectedOrg) return
    const res = await fetch('/api/finance/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: selectedOrg.id, ...data }),
    })
    if (res.ok) { const d = await res.json(); setSettings(d.settings) }
  }

  // ── AI CFO stream ──────────────────────────────────────────────────

  // ── Scenario Coach ─────────────────────────────────────────────────
  async function sendCoachMessage() {
    if (!coachInput.trim() || coachLoading) return
    const userMsg: CoachMessage = { role: 'user', content: coachInput.trim() }
    const newMsgs = [...coachMsgs, userMsg]
    setCoachMsgs(newMsgs)
    setCoachInput('')
    setCoachLoading(true)

    // Build context from current financial data
    const obligationText = obligations.length > 0
      ? obligations.map(o => `- ${o.label}: ${$$(o.amount)} due ${o.due_date}${o.notes ? ' ('+o.notes+')' : ''}`).join('\n')
      : 'None entered'

    const systemPrompt = `You are a CFO and financial scenario coach for ${selectedOrg?.name || 'this organization'}, a neuroscience wellness company.

CURRENT FINANCIAL SNAPSHOT (${moLabel(month)}):
- Gross Revenue (paid): ${$$(metrics.paidIncome)}
- Pending/Uncollected: ${$$(metrics.pendingIncome)}
- COGS: ${$$(metrics.cogsTotal)}
- Gross Profit: ${$$(metrics.grossProfit)} (${fmtP(metrics.grossMargin)} margin)
- Total Expenses: ${$$(metrics.totalExp)}
- Net Income: ${$$(metrics.netIncome)} (${fmtP(metrics.netMargin)} margin)

GOALS:
- Monthly Revenue Target: ${$$(settings.target_monthly_revenue)}
- Target Gross Margin: ${fmtP(settings.target_gross_margin)}
- Target Net Margin: ${fmtP(settings.target_net_margin)}
- Cash on Hand: ${$$(settings.cash_on_hand)}
- Monthly Burn Rate: ${$$(settings.monthly_burn_rate)}
- Avg CAC: ${$$(settings.avg_cac)} | Avg LTV: ${$$(settings.avg_ltv)} | Monthly Churn: ${fmtP(settings.avg_churn_pct)}

PRODUCT CATALOG:
${products.map(p => `- ${p.name}: $${p.price} (${p.category})`).join('\n') || 'No products configured'}

UPCOMING OBLIGATIONS:
${obligationText}

TOP EXPENSE GROUPS:
${metrics.topGroups.slice(0,5).map(g => `- ${g.group}: ${$$(g.total)}`).join('\n')}

Be direct, specific, and dollar-precise. Give actionable recommendations. When asked for scenarios, show the math. When asked for a spreadsheet or export, describe the structure clearly in a formatted table.`

    const messages = newMsgs.map(m => ({ role: m.role, content: m.content }))
    const assistantMsg: CoachMessage = { role: 'assistant', content: '' }
    setCoachMsgs(m => [...m, assistantMsg])

    try {
      const res = await fetch('/api/finance/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coach_mode: true, system_prompt: systemPrompt, messages }),
      })
      if (!res.body) throw new Error('No stream')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let text = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try { const d = JSON.parse(line.slice(6)); if (d.text) { text += d.text; setCoachMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: text }]) } } catch {}
          }
        }
      }
    } catch (err: any) {
      setCoachMsgs(m => [...m.slice(0, -1), { role: 'assistant', content: 'Error: ' + err.message }])
    } finally {
      setCoachLoading(false)
      setTimeout(() => coachEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100)
    }
  }

  async function runAiCfo() {
    if (!selectedOrg || aiStreaming) return
    setAiStreaming(true)
    setAiText('')
    const payload = {
      org_id: selectedOrg.id,
      org_name: selectedOrg.name,
      period_month: month,
      total_income: metrics.paidIncome,
      pending_income: metrics.pendingIncome,
      total_expenses: metrics.totalExp,
      cogs: metrics.cogsTotal,
      gross_profit: metrics.grossProfit,
      gross_margin_pct: metrics.grossMargin,
      net_income: metrics.netIncome,
      net_margin_pct: metrics.netMargin,
      income_count: income.filter(i => i.status === 'paid').length,
      top_products: metrics.topProducts,
      top_expense_groups: metrics.topGroups,
      target_gross_margin: settings.target_gross_margin,
      target_net_margin: settings.target_net_margin,
    }
    try {
      const res = await fetch('/api/finance/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      const reader = res.body!.getReader()
      const dec    = new TextDecoder()
      let   buf    = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6)
          if (raw === '[DONE]') break
          try { const d = JSON.parse(raw); if (d.text) setAiText(p => p + d.text) } catch {}
        }
      }
    } catch (err: any) { setAiText('Error: ' + err.message) }
    finally { setAiStreaming(false) }
  }

  // ── CSV Export ─────────────────────────────────────────────────────
  function exportIncome() {
    const rows = [['Date', 'Client', 'Product', 'Amount', 'Status', 'Source', 'Notes'],
      ...income.map(i => [i.txn_date, i.client_name || '', i.product_name || '', $c(i.amount), i.status, i.source, i.notes || ''])]
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href  = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    link.download = `${selectedOrg?.slug}-income-${month}.csv`
    link.click()
  }
  function exportExpenses() {
    const rows = [['Date', 'Vendor', 'Category', 'Group', 'COGS', 'Amount', 'Status', 'Recurring', 'Notes'],
      ...expenses.map(e => [e.txn_date, e.vendor, e.category_name || '', e.group_name || '', e.is_cogs ? 'Yes' : 'No', $c(e.amount), e.status, e.recurring ? 'Yes' : 'No', e.notes || ''])]
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const link = document.createElement('a')
    link.href  = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    link.download = `${selectedOrg?.slug}-expenses-${month}.csv`
    link.click()
  }

  // ── Guard: super admin only ────────────────────────────────────────
  if (!isSuperAdmin) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
          <Lock className="w-8 h-8 text-gray-400" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-np-dark">Financial Suite</h2>
          <p className="text-sm text-gray-500 mt-1">Super admin access required.</p>
        </div>
      </div>
    )
  }

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="max-w-[1200px] mx-auto space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-np-dark">Financial Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">P&amp;L · Income · Expenses · AI CFO Analysis</p>
        </div>


      </div>

      {/* Month navigator */}
      <div className="flex items-center gap-2">
        <button onClick={() => setMonth(prevMo(month))} className="p-2 hover:bg-white border border-transparent hover:border-gray-200 rounded-lg transition-all">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <div className="bg-white border border-gray-200 rounded-lg px-4 py-1.5 min-w-[160px] text-center">
          <span className="text-sm font-semibold text-np-dark">{moLabel(month)}</span>
        </div>
        <button onClick={() => setMonth(nextMo(month))} disabled={month >= curMonth()} className="p-2 hover:bg-white border border-transparent hover:border-gray-200 rounded-lg transition-all disabled:opacity-30">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
        <button onClick={() => setMonth(curMonth())} className="text-xs text-np-blue hover:underline ml-1">Today</button>
        {isNP && (
          <button onClick={syncNP} disabled={syncing} className="ml-auto flex items-center gap-1.5 text-xs font-medium text-teal-700 hover:text-teal-900 bg-teal-50 hover:bg-teal-100 border border-teal-200 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
            <RefreshCw className={`w-3 h-3 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Syncing...' : 'Sync NPU Platform'}
          </button>
        )}
      </div>

      {/* Tab nav */}
      <div className="flex gap-0.5 bg-white border border-gray-100 rounded-xl p-1 overflow-x-auto">
        {(['dashboard','income','expenses','clients','products','reports','settings','ai-cfo','goals','coach','projections','metrics','balance-sheet','unit-economics','cap-table'] as const).map(t => {
          const icons: Record<string, any> = { dashboard: BarChart3, income: TrendingUp, expenses: TrendingDown, clients: Users, products: Tag, reports: FileText, settings: Settings, 'ai-cfo': Brain, goals: Target, coach: MessageSquare, projections: TrendingDown, metrics: Flame, 'balance-sheet': Wallet, 'unit-economics': PieChart, 'cap-table': Shield }
          const labels: Record<string, string> = { dashboard: 'Dashboard', income: 'Income', expenses: 'Expenses', clients: 'Clients', products: 'Products', reports: 'Reports', settings: 'Settings', 'ai-cfo': '🧠 AI CFO', goals: 'Goals', coach: 'Scenario Coach', projections: 'Projections', metrics: 'Founder Metrics' }
          const Icon = icons[t]
          const sel  = tab === t
          return (
            <button key={t} onClick={() => setTab(t)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all whitespace-nowrap ${sel ? 'text-white shadow-sm' : 'text-gray-500 hover:text-np-dark'}`}
              style={sel ? { backgroundColor: orgColor } : {}}>
              <Icon className="w-3.5 h-3.5" />{labels[t]}
            </button>
          )
        })}
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-12">
          <RefreshCw className="w-6 h-6 text-np-blue animate-spin" />
        </div>
      )}

      {/* ──── DASHBOARD TAB ────────────────────────────────────────── */}
      {!loading && tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tip="Total paid & collected income for this period. Excludes pending and refunded transactions." label="Gross Revenue" value={$$(metrics.paidIncome)} color="text-emerald-700" />
            <Stat tip="Income recorded but not yet received — invoices sent, payments in process, or future-dated charges." label="Pending / Uncollected" value={$$(metrics.pendingIncome)} color="text-amber-600" />
            <Stat tip="All costs for this period including COGS (direct service costs) and operating expenses." label="Total Expenses" value={$$(metrics.totalExp)} color="text-red-600" />
            <Stat tip="What remains after all expenses. Gross Revenue minus Total Expenses. Negative = operating at a loss." label="Net Income" value={$$(metrics.netIncome)} color={metrics.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tip="Cost of Goods Sold — direct costs tied to delivering your services (e.g. platform fees, contractor pay, supplies)." label="COGS" value={$$(metrics.cogsTotal)} />
            <Stat tip="Revenue minus COGS only. Shows how profitable your core services are before overhead is factored in." label="Gross Profit" value={$$(metrics.grossProfit)} color="text-np-blue" />
            <Stat tip="Gross Profit as a % of Revenue. Measures service profitability. Your target is set in Settings." label="Gross Margin" value={fmtP(metrics.grossMargin)} color={metrics.grossMargin >= settings.target_gross_margin ? 'text-emerald-600' : 'text-amber-600'} />
            <Stat tip="Net Income as a % of Revenue. The bottom line — how much of every dollar earned you actually keep. Your target is set in Settings." label="Net Margin" value={fmtP(metrics.netMargin)} color={metrics.netMargin >= settings.target_net_margin ? 'text-emerald-600' : 'text-amber-600'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Margin targets */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center">Margin Performance<InfoTip text="Shows your actual gross and net margins vs. your targets. Green = on track, amber = below target. Targets are configured in Settings." /></h3>
              <MBar label="Gross Margin" actual={metrics.grossMargin} target={settings.target_gross_margin} color={orgColor} />
              <MBar label="Net Margin"   actual={metrics.netMargin}   target={settings.target_net_margin}   color={isNP ? '#34A853' : '#1e7a6f'} />
            </div>

            {/* Top revenue */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center">Top Revenue Sources<InfoTip text="Your highest-earning products or services this period, ranked by paid revenue. Only includes collected (paid) transactions." /></h3>
              {metrics.topProducts.slice(0, 5).length === 0
                ? <p className="text-xs text-gray-400">No paid income this period</p>
                : metrics.topProducts.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-xs font-medium text-np-dark truncate max-w-[180px]">{p.name}</span>
                    <span className="text-xs font-bold text-emerald-700">{$$(p.total)}</span>
                  </div>
                ))
              }
            </div>

            {/* Expense breakdown */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center">Expense Breakdown<InfoTip text="Total spending by expense group (e.g. Payroll, Software, Marketing). Helps identify where money is going each month." /></h3>
              {metrics.topGroups.length === 0
                ? <p className="text-xs text-gray-400">No expenses this period</p>
                : metrics.topGroups.slice(0, 6).map((g, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                    <span className="text-xs font-medium text-np-dark">{g.group}</span>
                    <span className="text-xs font-bold text-red-600">{$$(g.total)}</span>
                  </div>
                ))
              }
            </div>

            {/* Income statement summary */}
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center">Income Statement<InfoTip text="Standard P&L summary: Revenue → minus COGS → Gross Profit → minus Operating Expenses → Net Income." /></h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-600">Gross Revenue</span><span className="font-semibold text-emerald-700">{$$(metrics.paidIncome)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600 pl-3">— Cost of Goods Sold</span><span className="text-red-500">({$$(metrics.cogsTotal)})</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5"><span className="font-semibold text-np-dark">Gross Profit</span><span className="font-bold" style={{ color: orgColor }}>{$$(metrics.grossProfit)} <span className="text-gray-400 font-normal">({fmtP(metrics.grossMargin)})</span></span></div>
                <div className="flex justify-between mt-1"><span className="text-gray-600 pl-3">— Operating Expenses</span><span className="text-red-500">({$$(metrics.totalExp - metrics.cogsTotal)})</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5"><span className="font-bold text-np-dark">Net Income</span><span className={`font-bold ${metrics.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{$$(metrics.netIncome)} <span className="text-gray-400 font-normal">({fmtP(metrics.netMargin)})</span></span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ──── INCOME TAB ───────────────────────────────────────────── */}
      {!loading && tab === 'income' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search income…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
            </div>
            <Btn onClick={exportIncome} variant="secondary" size="xs"><Download className="w-3.5 h-3.5" />CSV</Btn>
            <Btn onClick={() => { setEditIncome(null); setShowIncomeModal(true) }} size="xs"><Plus className="w-3.5 h-3.5" />Add Income</Btn>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Client</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Product</th>
                  <th className="text-right px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Amount</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-2.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider hidden md:table-cell">Source</th>
                  <th className="px-4 py-2.5 w-16" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredIncome.length === 0
                  ? <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No income records for {moLabel(month)}</td></tr>
                  : filteredIncome.map(i => (
                    <tr key={i.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-4 py-2.5 text-xs text-gray-600 whitespace-nowrap">{fmtDate(i.txn_date)}</td>
                      <td className="px-4 py-2.5 text-xs font-medium text-np-dark max-w-[140px] truncate">{i.client_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[140px] truncate">{i.product_name || '—'}</td>
                      <td className="px-4 py-2.5 text-xs font-bold text-right text-emerald-700">{$c(i.amount)}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${({ paid: 'bg-emerald-50 text-emerald-700', pending: 'bg-amber-50 text-amber-700', refunded: 'bg-gray-100 text-gray-500', disputed: 'bg-orange-50 text-orange-600' } as any)[i.status] || ''}`}>{i.status}</span>
                      </td>
                      <td className="px-4 py-2.5 hidden md:table-cell">
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${{ manual: 'bg-blue-50 text-blue-700', stripe: 'bg-violet-50 text-violet-700', np_platform: 'bg-teal-50 text-teal-700' }[i.source] || ''}`}>
                          {{ manual: 'Manual', stripe: 'Stripe', np_platform: 'NPU Platform' }[i.source]}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {(i as any).income_category === 'investment' && (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">INVEST</span>
                            )}
                          {i.source !== 'np_platform' && (
                            <>
                              <button onClick={() => { setEditIncome(i); setShowIncomeModal(true) }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-np-blue transition-colors"><Pencil className="w-3 h-3" /></button>
                              <button onClick={() => deleteIncome(i.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-3 h-3" /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
              {filteredIncome.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td colSpan={3} className="px-4 py-2.5 text-xs font-semibold text-gray-600">Total Paid</td>
                    <td className="px-4 py-2.5 text-xs font-bold text-right text-emerald-700">{$c(filteredIncome.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0))}</td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}

      {/* ──── EXPENSES TAB ─────────────────────────────────────────── */}
      {!loading && tab === 'expenses' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expenses…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
            </div>
            <Btn onClick={exportExpenses} variant="secondary" size="xs"><Download className="w-3.5 h-3.5" />CSV</Btn>
            <Btn onClick={() => { setEditExpense(null); setShowExpenseModal(true) }} size="xs"><Plus className="w-3.5 h-3.5" />Add Expense</Btn>
          </div>

          <div className="space-y-3">
            {expensesByGroup.length === 0
              ? <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-sm text-gray-400">No expenses for {moLabel(month)}</div>
              : expensesByGroup.map(([group, exps]) => (
                <div key={group} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                  <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                    <span className="text-xs font-bold text-np-dark uppercase tracking-wider">{group}</span>
                    <span className="text-xs font-bold text-red-600">{$$(exps.reduce((s, e) => s + e.amount, 0))}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-50">
                      {exps.map(e => (
                        <tr key={e.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-4 py-2 text-xs text-gray-500 whitespace-nowrap w-24">{fmtDate(e.txn_date)}</td>
                          <td className="px-4 py-2 text-xs font-medium text-np-dark">{e.vendor}</td>
                          <td className="px-4 py-2 text-xs text-gray-500 hidden md:table-cell">{e.category_name || '—'}</td>
                          <td className="px-4 py-2">
                            {e.is_cogs && <span className="text-[9px] font-bold bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full mr-1">COGS</span>}
                            {e.recurring && <span className="text-[9px] font-bold bg-blue-50 text-blue-600 border border-blue-100 px-1.5 py-0.5 rounded-full">Recurring</span>}
                          </td>
                          <td className="px-4 py-2 text-xs font-bold text-right text-red-600">{$c(e.amount)}</td>
                          <td className="px-4 py-2 w-16">
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => { setEditExpense(e); setShowExpenseModal(true) }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-np-blue transition-colors"><Pencil className="w-3 h-3" /></button>
                              <button onClick={() => deleteExpense(e.id)} className="p-1 hover:bg-red-50 rounded text-gray-400 hover:text-red-600 transition-colors"><Trash2 className="w-3 h-3" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ──── CLIENTS TAB ──────────────────────────────────────────── */}
      {!loading && tab === 'clients' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clients…" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
            </div>
            <Btn onClick={() => { setEditClient(null); setShowClientModal(true) }} size="xs"><Plus className="w-3.5 h-3.5" />Add Client</Btn>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredClients.map(c => {
              const cIncome = income.filter(i => i.client_name === c.name && i.status === 'paid').reduce((s, i) => s + i.amount, 0)
              return (
                <div key={c.id} className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold text-np-dark text-sm">{c.name}</p>
                      {c.email && <p className="text-xs text-gray-500 mt-0.5">{c.email}</p>}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => { setEditClient(c); setShowClientModal(true) }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-np-blue transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                  <div className="mt-3 flex gap-3 text-xs">
                    <div><span className="text-gray-400">Contract</span><p className="font-bold text-np-dark">{$$(c.contract_value)}</p></div>
                    <div><span className="text-gray-400">Paid this month</span><p className="font-bold text-emerald-600">{$$(cIncome)}</p></div>
                  </div>
                  {c.notes && <p className="text-xs text-gray-400 mt-2 line-clamp-2">{c.notes}</p>}
                </div>
              )
            })}
            {filteredClients.length === 0 && <div className="col-span-3 bg-white border border-gray-100 rounded-xl p-8 text-center text-sm text-gray-400">No clients yet</div>}
          </div>
        </div>
      )}

      {/* ──── PRODUCTS TAB ─────────────────────────────────────────── */}
      {!loading && tab === 'products' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Products and services for {selectedOrg?.name} — used when recording income.</p>
            <Btn onClick={() => { setEditProduct(null); setShowProductModal(true) }} size="xs"><Plus className="w-3.5 h-3.5" />Add Product</Btn>
          </div>

          {/* Group by category */}
          {(() => {
            const byCat: Record<string, Product[]> = {}
            products.forEach(p => { const c = p.category || 'Other'; if (!byCat[c]) byCat[c] = []; byCat[c].push(p) })
            return Object.entries(byCat).map(([cat, prods]) => (
              <div key={cat} className="bg-white border border-gray-100 rounded-xl overflow-hidden shadow-sm">
                <div className="px-4 py-2.5 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-bold text-np-dark uppercase tracking-wider">{cat}</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {prods.map(p => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <span className="text-sm font-medium text-np-dark">{p.name}</span>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-np-blue">{p.price > 0 ? $c(p.price) : '—'}</span>
                        <button onClick={() => { setEditProduct(p); setShowProductModal(true) }} className="p-1 hover:bg-gray-100 rounded text-gray-400 hover:text-np-blue transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))
          })()}
          {products.length === 0 && <div className="bg-white border border-gray-100 rounded-xl p-8 text-center text-sm text-gray-400">No products yet</div>}
        </div>
      )}

      {/* ──── REPORTS TAB ──────────────────────────────────────────── */}
      {!loading && tab === 'reports' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-np-dark">P&amp;L Statement — {moLabel(month)}</h3>
              <div className="flex gap-2">
                <Btn onClick={exportIncome}   variant="secondary" size="xs"><Download className="w-3.5 h-3.5" />Income CSV</Btn>
                <Btn onClick={exportExpenses} variant="secondary" size="xs"><Download className="w-3.5 h-3.5" />Expenses CSV</Btn>
              </div>
            </div>
            <div className="space-y-1 text-sm font-mono">
              <div className="flex justify-between py-1 border-b border-gray-100 font-bold text-np-dark text-base">
                <span>REVENUE</span><span className="text-emerald-700">{$c(metrics.paidIncome)}</span>
              </div>
              {metrics.topProducts.map((p, i) => (
                <div key={i} className="flex justify-between py-0.5 pl-4 text-xs text-gray-600">
                  <span>{p.name} ({p.count})</span><span>{$c(p.total)}</span>
                </div>
              ))}
              <div className="flex justify-between py-1 mt-2 border-b border-gray-100">
                <span className="text-gray-600">Less: Cost of Goods Sold</span><span className="text-red-500">({$c(metrics.cogsTotal)})</span>
              </div>
              <div className="flex justify-between py-1 font-bold text-np-dark">
                <span>GROSS PROFIT</span><span style={{ color: orgColor }}>{$c(metrics.grossProfit)} ({fmtP(metrics.grossMargin)})</span>
              </div>
              <div className="pt-3 border-t border-gray-100 font-bold text-np-dark">OPERATING EXPENSES</div>
              {metrics.topGroups.filter(g => !['Cost of Goods Sold'].includes(g.group)).map((g, i) => (
                <div key={i} className="flex justify-between py-0.5 pl-4 text-xs text-gray-600">
                  <span>{g.group}</span><span className="text-red-500">({$c(g.total)})</span>
                </div>
              ))}
              <div className="flex justify-between py-1 border-t border-gray-100">
                <span className="text-gray-600">Total Operating Expenses</span><span className="text-red-500">({$c(metrics.totalExp - metrics.cogsTotal)})</span>
              </div>
              <div className="flex justify-between py-2 border-t-2 border-np-dark font-bold text-base">
                <span>NET INCOME</span><span className={metrics.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}>{$c(metrics.netIncome)} ({fmtP(metrics.netMargin)})</span>
              </div>
              {metrics.pendingIncome > 0 && (
                <div className="mt-4 p-3 bg-amber-50 border border-amber-100 rounded-lg text-xs text-amber-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  <span><strong>{$c(metrics.pendingIncome)}</strong> in pending / uncollected income not included in revenue above.</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ──── SETTINGS TAB ─────────────────────────────────────────── */}
      {!loading && tab === 'settings' && (
        <div className="max-w-lg space-y-4">
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-np-dark mb-4">Margin Targets</h3>
            <div className="space-y-4">
              <FInput label="Target Gross Margin (%)" type="number" min="0" max="100" step="1"
                defaultValue={settings.target_gross_margin}
                key={`gm-${settings.target_gross_margin}`}
                onBlur={e => saveSettings({ ...settings, target_gross_margin: parseFloat(e.target.value) || 60 })} />
              <FInput label="Target Net Margin (%)" type="number" min="0" max="100" step="1"
                defaultValue={settings.target_net_margin}
                key={`nm-${settings.target_net_margin}`}
                onBlur={e => saveSettings({ ...settings, target_net_margin: parseFloat(e.target.value) || 30 })} />
              <FSelect label="Fiscal Year Start"
                value={settings.fiscal_year_start_month}
                onChange={e => saveSettings({ ...settings, fiscal_year_start_month: parseInt(e.target.value) || 1 })}>
                {[['1','January'],['4','April'],['7','July'],['10','October']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
              </FSelect>
            </div>
          </div>

          {isNP && (
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-np-dark mb-2">NPU Platform Sync</h3>
              <p className="text-xs text-gray-500 mb-3">Sync payments from the NPU Platform into this ledger. Only new records are added. Platform records are read-only once synced.</p>
              <div className="text-xs bg-gray-50 rounded-lg p-3 font-mono text-gray-600 mb-3">
                POST /api/finance/np-sync<br />
                {'{'} org_id, month? {'}'}
              </div>
              <Btn onClick={syncNP} disabled={syncing} variant="secondary">
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                {syncing ? 'Syncing...' : 'Sync Now'}
              </Btn>
            </div>
          )}

          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-np-dark mb-2">Stripe Webhook</h3>
            <p className="text-xs text-gray-500 mb-2">Point your Stripe webhook to this endpoint to auto-import payments.</p>
            <div className="text-xs bg-gray-50 rounded-lg p-3 font-mono text-gray-600 mb-1 break-all">
              https://hub.neuroprogeny.com/api/finance/stripe
            </div>
            <p className="text-[10px] text-gray-400">Events: checkout.session.completed · payment_intent.succeeded · invoice.payment_succeeded · charge.refunded · payment_intent.payment_failed</p>
            <p className="text-[10px] text-gray-400 mt-1">Set <code className="bg-gray-100 px-1 rounded">{isNP ? 'STRIPE_WEBHOOK_SECRET' : 'SENSORIUM_STRIPE_WEBHOOK_SECRET'}</code> in Vercel env vars.</p>
          </div>
        </div>
      )}

      {/* ──── AI CFO TAB ───────────────────────────────────────────── */}
      {!loading && tab === 'ai-cfo' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-np-dark flex items-center gap-2"><Brain className="w-4 h-4 text-np-blue" /> AI CFO — Monthly Analysis</h3>
              <p className="text-xs text-gray-500">Claude acts as your CFO — reviews P&L, flags margin risks, and gives you one priority action for the month.</p>
            </div>
            <Btn onClick={runAiCfo} disabled={aiStreaming || metrics.paidIncome === 0}>
              <Zap className={`w-3.5 h-3.5 ${aiStreaming ? 'animate-pulse' : ''}`} />
              {aiStreaming ? 'Analyzing…' : aiText ? 'Re-run Analysis' : 'Run Analysis'}
            </Btn>
          </div>

          {metrics.paidIncome === 0 && !aiText && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-xs text-amber-700">
              Add income records for {moLabel(month)} before running the AI analysis.
            </div>
          )}

          {aiText && (
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <div className="font-mono text-xs text-np-dark whitespace-pre-wrap leading-relaxed tracking-tight">{aiText}</div>
              {aiStreaming && <span className="inline-block w-1.5 h-4 bg-np-blue animate-pulse ml-1 rounded-sm align-text-bottom" />}
            </div>
          )}
        </div>
      )}


      {/* ──── GOALS TAB ──────────────────────────────────────────── */}
      {!loading && tab === 'goals' && (
        <div className="space-y-5 max-w-2xl">
          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-np-dark mb-1 flex items-center gap-2"><Target className="w-4 h-4 text-np-blue" />Revenue & Margin Goals</h3>
            <p className="text-xs text-gray-400 mb-4">These targets power the Projections tab and Scenario Coach context.</p>
            <div className="grid grid-cols-2 gap-4">
              <FInput label="Monthly Revenue Target ($)" type="number" min="0"
                defaultValue={settings.target_monthly_revenue || ''}
                key={`tmr-${settings.target_monthly_revenue}`}
                onBlur={e => saveSettings({ ...settings, target_monthly_revenue: parseFloat(e.target.value) || 0 })} />
              <FInput label="Target Gross Margin (%)" type="number" min="0" max="100"
                defaultValue={settings.target_gross_margin}
                key={`tgm-${settings.target_gross_margin}`}
                onBlur={e => saveSettings({ ...settings, target_gross_margin: parseFloat(e.target.value) || 60 })} />
              <FInput label="Target Net Margin (%)" type="number" min="0" max="100"
                defaultValue={settings.target_net_margin}
                key={`tnm-${settings.target_net_margin}`}
                onBlur={e => saveSettings({ ...settings, target_net_margin: parseFloat(e.target.value) || 30 })} />
              <FInput label="Target Monthly Expenses ($)" type="number" min="0"
                defaultValue={settings.monthly_burn_rate || ''}
                key={`mbr-${settings.monthly_burn_rate}`}
                onBlur={e => saveSettings({ ...settings, monthly_burn_rate: parseFloat(e.target.value) || 0 })} />
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-np-dark mb-1 flex items-center gap-2"><LifeBuoy className="w-4 h-4 text-teal-600" />Cash & Runway</h3>
            <p className="text-xs text-gray-400 mb-4">Used to calculate runway and survival metrics.</p>
            <div className="grid grid-cols-2 gap-4">
              <FInput label="Cash on Hand ($)" type="number" min="0"
                defaultValue={settings.cash_on_hand || ''}
                key={`coh-${settings.cash_on_hand}`}
                onBlur={e => saveSettings({ ...settings, cash_on_hand: parseFloat(e.target.value) || 0 })} />
              <FInput label="Monthly Burn Rate ($)" type="number" min="0"
                defaultValue={settings.monthly_burn_rate || ''}
                key={`mbr2-${settings.monthly_burn_rate}`}
                onBlur={e => saveSettings({ ...settings, monthly_burn_rate: parseFloat(e.target.value) || 0 })} />
            </div>
            {settings.cash_on_hand > 0 && settings.monthly_burn_rate > 0 && (
              <div className={`mt-3 rounded-lg px-4 py-3 text-sm font-semibold ${(settings.cash_on_hand / settings.monthly_burn_rate) < 3 ? 'bg-red-50 text-red-700' : (settings.cash_on_hand / settings.monthly_burn_rate) < 6 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                Runway: {(settings.cash_on_hand / settings.monthly_burn_rate).toFixed(1)} months
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-np-dark mb-1 flex items-center gap-2"><Users className="w-4 h-4 text-purple-600" />Customer Economics</h3>
            <p className="text-xs text-gray-400 mb-4">CAC, LTV and churn power the Founder Metrics tab.</p>
            <div className="grid grid-cols-3 gap-4">
              <FInput label="Avg CAC ($)" type="number" min="0"
                defaultValue={settings.avg_cac || ''}
                key={`cac-${settings.avg_cac}`}
                onBlur={e => saveSettings({ ...settings, avg_cac: parseFloat(e.target.value) || 0 })} />
              <FInput label="Avg LTV ($)" type="number" min="0"
                defaultValue={settings.avg_ltv || ''}
                key={`ltv-${settings.avg_ltv}`}
                onBlur={e => saveSettings({ ...settings, avg_ltv: parseFloat(e.target.value) || 0 })} />
              <FInput label="Monthly Churn (%)" type="number" min="0" max="100" step="0.1"
                defaultValue={settings.avg_churn_pct || ''}
                key={`churn-${settings.avg_churn_pct}`}
                onBlur={e => saveSettings({ ...settings, avg_churn_pct: parseFloat(e.target.value) || 0 })} />
            </div>
            {settings.avg_cac > 0 && settings.avg_ltv > 0 && (
              <div className={`mt-3 rounded-lg px-4 py-3 text-sm font-semibold flex items-center justify-between ${settings.avg_ltv / settings.avg_cac >= 3 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                <span>LTV:CAC Ratio</span>
                <span>{(settings.avg_ltv / settings.avg_cac).toFixed(1)}x {settings.avg_ltv / settings.avg_cac >= 3 ? '✓ Healthy' : '⚠ Below 3x target'}</span>
              </div>
            )}
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-np-dark flex items-center gap-2"><Calendar className="w-4 h-4 text-red-500" />Upcoming Obligations</h3>
              <Btn size="xs" onClick={() => setObligations(o => [...o, { id: crypto.randomUUID(), label: '', amount: 0, due_date: '', notes: '' }])}>
                <Plus className="w-3.5 h-3.5" />Add
              </Btn>
            </div>
            <p className="text-xs text-gray-400 mb-3">Balloon payments, loan payments, big upcoming expenses. The Scenario Coach uses these.</p>
            {obligations.length === 0 && <p className="text-xs text-gray-400">No obligations added yet.</p>}
            <div className="space-y-2">
              {obligations.map((ob, i) => (
                <div key={ob.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4"><FInput label="" placeholder="Label (e.g. Loan payment)" value={ob.label} onChange={e => setObligations(o => o.map((x,j) => j===i ? {...x, label: e.target.value} : x))} /></div>
                  <div className="col-span-2"><FInput label="" type="number" placeholder="Amount" value={String(ob.amount||'')} onChange={e => setObligations(o => o.map((x,j) => j===i ? {...x, amount: parseFloat(e.target.value)||0} : x))} /></div>
                  <div className="col-span-3"><FInput label="" type="date" value={ob.due_date} onChange={e => setObligations(o => o.map((x,j) => j===i ? {...x, due_date: e.target.value} : x))} /></div>
                  <div className="col-span-2"><FInput label="" placeholder="Notes" value={ob.notes} onChange={e => setObligations(o => o.map((x,j) => j===i ? {...x, notes: e.target.value} : x))} /></div>
                  <div className="col-span-1 flex justify-end"><button onClick={() => setObligations(o => o.filter((_,j) => j!==i))} className="p-1 text-red-400 hover:text-red-600"><X className="w-3.5 h-3.5" /></button></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ──── SCENARIO COACH TAB ─────────────────────────────────── */}
      {!loading && tab === 'coach' && (
        <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
          <div className="bg-gradient-to-r from-np-blue/5 to-purple-50 border border-np-blue/10 rounded-xl p-4 mb-3 flex-shrink-0">
            <p className="text-xs text-np-dark font-medium flex items-center gap-2"><Brain className="w-3.5 h-3.5 text-np-blue" />Scenario Coach is pre-loaded with your current P&L, goals, product catalog, and upcoming obligations. Ask anything.</p>
            <p className="text-[11px] text-gray-500 mt-1">Try: "What does my product mix need to look like to hit my revenue goal?" · "What price does my Mastermind need to be at 40% net margin?" · "How many clients do I need to break even?"</p>
          </div>

          <div className="flex-1 overflow-y-auto bg-white border border-gray-100 rounded-xl p-4 space-y-3 mb-3" ref={coachEndRef}>
            {coachMsgs.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center py-8">
                <MessageSquare className="w-8 h-8 text-gray-200 mb-3" />
                <p className="text-sm text-gray-400">Start by describing your situation or goal.</p>
                <div className="mt-4 grid grid-cols-1 gap-2 w-full max-w-md">
                  {["What combination of products and prices hits my revenue target?","How many months of runway do I have if revenue drops 30%?","What needs to change to reach profitability this quarter?","Build me a break-even analysis for my Mastermind program"].map(q => (
                    <button key={q} onClick={() => setCoachInput(q)} className="text-left text-xs text-np-blue bg-np-blue/5 hover:bg-np-blue/10 border border-np-blue/10 rounded-lg px-3 py-2 transition-colors">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {coachMsgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap ${m.role === 'user' ? 'bg-np-blue text-white' : 'bg-gray-50 border border-gray-100 text-np-dark'}`}>
                  {m.content}
                  {i === coachMsgs.length - 1 && coachLoading && m.role === 'assistant' && <span className="inline-block w-1.5 h-4 bg-np-blue/40 animate-pulse ml-1 rounded-sm align-text-bottom" />}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <input
              value={coachInput}
              onChange={e => setCoachInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && coachInput.trim()) { e.preventDefault(); sendCoachMessage() } }}
              placeholder="Ask about pricing, break-even, runway, product mix..."
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30 focus:border-np-blue"
              disabled={coachLoading}
            />
            <button onClick={sendCoachMessage} disabled={coachLoading || !coachInput.trim()} className="px-4 py-2.5 bg-np-blue text-white rounded-xl hover:bg-np-blue/90 disabled:opacity-50 transition-colors flex items-center gap-2">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ──── PROJECTIONS TAB ────────────────────────────────────── */}
      {!loading && tab === 'projections' && (() => {
        const targetRev = settings.target_monthly_revenue || 0
        const targetGM  = settings.target_gross_margin / 100
        const targetNM  = settings.target_net_margin / 100
        const actualRev = metrics.paidIncome
        const gap       = targetRev - actualRev
        const revenueGapPct = targetRev > 0 ? (actualRev / targetRev) * 100 : 0

        // Break-even: fixed costs / gross margin %
        const fixedCosts = expenses.filter(e => !e.is_cogs).reduce((s, e) => s + e.amount, 0)
        const breakEven  = metrics.grossMargin > 0 ? fixedCosts / (metrics.grossMargin / 100) : 0

        // What revenue is needed to hit target net margin
        const revenueForTargetNM = fixedCosts > 0 && targetNM < 1 ? fixedCosts / (targetNM + (1 - targetGM)) : 0

        // Product mix: how many of each product to hit target
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Revenue Target" value={$$(targetRev)} tip="Your monthly revenue goal set in Goals." color="text-np-blue" />
              <Stat label="Revenue Gap" value={gap > 0 ? `${$$(gap)} short` : 'On Target ✓'} color={gap > 0 ? 'text-red-600' : 'text-emerald-600'} tip="How far current paid revenue is from your monthly target." />
              <Stat label="Break-Even Revenue" value={$$(breakEven)} tip="Minimum revenue to cover all costs at your current gross margin. Below this = operating at a loss." />
              <Stat label="Revenue for Target NM" value={$$(revenueForTargetNM)} tip={`Revenue needed to hit your ${fmtP(settings.target_net_margin)} net margin target given current fixed costs.`} />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Target className="w-4 h-4 text-np-blue" />Revenue Progress</h3>
                <div className="mb-2 flex justify-between text-xs text-gray-500">
                  <span>{$$(actualRev)} actual</span>
                  <span>{$$(targetRev)} target</span>
                </div>
                <div className="h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(revenueGapPct, 100)}%`, backgroundColor: revenueGapPct >= 100 ? '#10b981' : revenueGapPct >= 70 ? '#f59e0b' : '#ef4444' }} />
                </div>
                <p className="text-xs text-gray-500 mt-2">{revenueGapPct.toFixed(0)}% of monthly target</p>

                {gap > 0 && products.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs font-semibold text-gray-600 mb-2">Units needed to close gap:</p>
                    <div className="space-y-1.5">
                      {products.filter(p => p.price > 0).slice(0, 5).map(p => (
                        <div key={p.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-lg px-3 py-2">
                          <span className="text-np-dark font-medium truncate max-w-[160px]">{p.name}</span>
                          <span className="text-np-blue font-bold ml-2">{Math.ceil(gap / p.price)} units @ {$$(p.price)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" />Contribution Margin by Product</h3>
                {products.filter(p => p.price > 0).length === 0
                  ? <p className="text-xs text-gray-400">Add products with prices in the Products tab.</p>
                  : <div className="space-y-2">
                    {products.filter(p => p.price > 0).map(p => {
                      const cogs = metrics.cogsTotal > 0 && metrics.paidIncome > 0 ? (metrics.cogsTotal / metrics.paidIncome) * p.price : 0
                      const cm   = p.price - cogs
                      const cmPct = p.price > 0 ? (cm / p.price) * 100 : 0
                      return (
                        <div key={p.id} className="text-xs">
                          <div className="flex justify-between mb-1">
                            <span className="font-medium text-np-dark truncate max-w-[160px]">{p.name}</span>
                            <span className="text-gray-500">{fmtP(cmPct)} CM · {$$(cm)}/unit</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full"><div className="h-full rounded-full bg-np-blue" style={{ width: `${Math.max(0, Math.min(cmPct, 100))}%` }} /></div>
                        </div>
                      )
                    })}
                  </div>
                }
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2"><Calendar className="w-4 h-4 text-red-500" />Upcoming Obligations</h3>
                {obligations.length === 0
                  ? <p className="text-xs text-gray-400">Add balloon payments and obligations in the Goals tab.</p>
                  : <div className="space-y-2">
                    {obligations.sort((a,b) => a.due_date.localeCompare(b.due_date)).map(ob => (
                      <div key={ob.id} className="flex items-center justify-between text-xs bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                        <div><span className="font-semibold text-red-700">{ob.label}</span>{ob.notes && <span className="text-red-400 ml-2">· {ob.notes}</span>}</div>
                        <div className="text-right ml-4"><div className="font-bold text-red-700">{$$(ob.amount)}</div><div className="text-red-400">{ob.due_date}</div></div>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-bold border-t border-gray-100 pt-2 mt-2">
                      <span>Total obligations</span>
                      <span className="text-red-700">{$$(obligations.reduce((s,o) => s + o.amount, 0))}</span>
                    </div>
                  </div>
                }
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2"><FileText className="w-4 h-4 text-gray-500" />P&L Summary</h3>
                <div className="space-y-1.5 text-xs">
                  {[
                    ['Gross Revenue', $$(metrics.paidIncome), 'text-emerald-700'],
                    ['Pending', $$(metrics.pendingIncome), 'text-amber-600'],
                    ['COGS', `(${$$(metrics.cogsTotal)})`, 'text-red-500'],
                    ['Gross Profit', $$(metrics.grossProfit), 'text-np-blue font-bold'],
                    ['Operating Expenses', `(${$$(metrics.totalExp - metrics.cogsTotal)})`, 'text-red-500'],
                    ['Net Income', $$(metrics.netIncome), metrics.netIncome >= 0 ? 'text-emerald-700 font-bold' : 'text-red-700 font-bold'],
                  ].map(([label, val, cls]) => (
                    <div key={label} className="flex justify-between">
                      <span className="text-gray-500">{label}</span>
                      <span className={cls}>{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ──── FOUNDER METRICS TAB ────────────────────────────────── */}
      {!loading && tab === 'metrics' && (() => {
        const burnRate  = settings.monthly_burn_rate || metrics.totalExp
        const runway    = burnRate > 0 ? settings.cash_on_hand / burnRate : 0
        const ltvcac    = settings.avg_cac > 0 ? settings.avg_ltv / settings.avg_cac : 0
        const payback   = settings.avg_ltv > 0 && settings.avg_cac > 0 ? settings.avg_cac / (settings.avg_ltv / 12) : 0
        const arpu      = clients.length > 0 ? metrics.paidIncome / clients.length : 0
        const fixedCosts = expenses.filter(e => !e.is_cogs).reduce((s, e) => s + e.amount, 0)
        const variableCosts = metrics.cogsTotal
        const contribMargin = metrics.contribMargin
        const contribMarginPct = metrics.contribMarginPct
        const breakEven = contribMarginPct > 0 ? fixedCosts / (contribMarginPct / 100) : 0
        const ebitda = metrics.netIncome + (settings.monthly_interest || 0) + (settings.monthly_depreciation || 0) + (settings.monthly_amortization || 0)
        const unitsToBreakEven = products.length > 0 && products[0].price > 0 ? breakEven / products[0].price : 0

        const MetricCard = ({ label, value, sub, tip, status }: { label: string; value: string; sub?: string; tip: string; status?: 'good'|'warn'|'bad'|null }) => (
          <div className={`bg-white border rounded-xl p-4 shadow-sm ${status === 'good' ? 'border-emerald-200' : status === 'warn' ? 'border-amber-200' : status === 'bad' ? 'border-red-200' : 'border-gray-100'}`}>
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">{label}<InfoTip text={tip} /></p>
            <p className={`text-xl font-bold ${status === 'good' ? 'text-emerald-700' : status === 'warn' ? 'text-amber-600' : status === 'bad' ? 'text-red-600' : 'text-np-dark'}`}>{value}</p>
            {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
          </div>
        )

        return (
          <div className="space-y-5">
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
              <strong>Setup tip:</strong> Set your Cash on Hand, Burn Rate, CAC, LTV and Churn in the <button onClick={() => setTab('goals')} className="underline font-semibold">Goals tab</button> to unlock all metrics below.
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Can I deliver it profitably?</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard label="Gross Margin" value={fmtP(metrics.grossMargin)} tip="Gross profit as % of revenue. Measures service profitability before overhead." status={metrics.grossMargin >= settings.target_gross_margin ? 'good' : 'warn'} />
                <MetricCard label="Contribution Margin" value={fmtP(contribMarginPct)} sub={`${$$(contribMargin)} absolute`} tip="Revenue minus variable costs. How much each dollar of revenue contributes toward overhead and profit." status={contribMarginPct >= 40 ? 'good' : contribMarginPct >= 20 ? 'warn' : 'bad'} />
                <MetricCard label="Net Margin" value={fmtP(metrics.netMargin)} tip="Bottom line — what % of every dollar earned you keep." status={metrics.netMargin >= settings.target_net_margin ? 'good' : metrics.netMargin >= 0 ? 'warn' : 'bad'} />
                <MetricCard label="Break-Even Revenue" value={$$(breakEven)} sub={unitsToBreakEven > 0 ? `≈${Math.ceil(unitsToBreakEven)} units of top product` : undefined} tip="Minimum monthly revenue to cover all costs at current gross margin." />
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Can I survive long enough to scale?</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard label="Burn Rate" value={$$(burnRate)} sub="per month" tip="How much cash leaves the business each month. Uses actual expenses if no target set." status={burnRate > metrics.paidIncome ? 'bad' : burnRate > metrics.paidIncome * 0.8 ? 'warn' : 'good'} />
                <MetricCard label="Runway" value={runway > 0 ? `${runway.toFixed(1)} mo` : '—'} tip="Months of cash remaining at current burn rate. Set Cash on Hand in Goals." status={runway <= 0 ? null : runway < 3 ? 'bad' : runway < 6 ? 'warn' : 'good'} sub={runway > 0 ? (runway < 3 ? '🚨 Critical' : runway < 6 ? '⚠ Low' : '✓ Healthy') : 'Set cash on hand in Goals'} />
                <MetricCard label="Net Income" value={$$(metrics.netIncome)} tip="What remains after all expenses. Negative = burning cash." status={metrics.netIncome >= 0 ? 'good' : 'bad'} />
                <MetricCard label="Cash Flow Signal" value={metrics.pendingIncome > metrics.paidIncome * 0.3 ? 'Watch AR' : 'OK'} sub={`${$$(metrics.pendingIncome)} uncollected`} tip="High pending income vs paid can signal cash flow risk even if revenue looks good." status={metrics.pendingIncome > metrics.paidIncome * 0.3 ? 'warn' : 'good'} />
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Can I sell it efficiently?</p>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <MetricCard label="LTV:CAC Ratio" value={ltvcac > 0 ? `${ltvcac.toFixed(1)}x` : '—'} tip="Lifetime value vs cost to acquire. 3x+ is healthy. Below 1x means you lose money on each customer." status={ltvcac <= 0 ? null : ltvcac >= 3 ? 'good' : ltvcac >= 1 ? 'warn' : 'bad'} sub={ltvcac >= 3 ? '✓ Healthy' : ltvcac > 0 ? '⚠ Below 3x target' : 'Set CAC + LTV in Goals'} />
                <MetricCard label="Payback Period" value={payback > 0 ? `${payback.toFixed(1)} mo` : '—'} tip="How long to recover your customer acquisition cost from their revenue." sub={payback > 0 ? (payback <= 12 ? '✓ Good' : '⚠ Long payback') : 'Set CAC + LTV in Goals'} status={payback <= 0 ? null : payback <= 12 ? 'good' : 'warn'} />
                <MetricCard label="ARPU" value={arpu > 0 ? $$(arpu) : '—'} sub="per client this period" tip="Average Revenue Per User — total paid revenue divided by number of clients on record." />
                <MetricCard label="Churn Rate" value={settings.avg_churn_pct > 0 ? fmtP(settings.avg_churn_pct) : '—'} tip="Monthly percentage of customers who cancel or drop off." status={settings.avg_churn_pct <= 0 ? null : settings.avg_churn_pct <= 5 ? 'good' : settings.avg_churn_pct <= 10 ? 'warn' : 'bad'} sub={'Set in Goals tab'} />
              </div>
            </div>

            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2"><FileText className="w-4 h-4" />Full P&L Statement</h3>
              <div className="space-y-1 text-xs max-w-md">
                {[
                  { label: 'Gross Revenue', val: $$(metrics.paidIncome), cls: 'text-emerald-700 font-semibold', indent: 0 },
                  { label: 'Operating Revenue', val: $$(metrics.operatingIncome), cls: 'text-emerald-600', indent: 1 },
                  { label: 'Investment Income', val: $$(metrics.investmentIncome), cls: 'text-purple-600', indent: 1 },
                  { label: 'Pending / Uncollected', val: $$(metrics.pendingIncome), cls: 'text-amber-600', indent: 1 },
                  { label: 'Cost of Goods Sold (COGS)', val: `(${$$(metrics.cogsTotal)})`, cls: 'text-red-500', indent: 1 },
                  { label: 'Gross Profit', val: $$(metrics.grossProfit), cls: 'text-np-blue font-bold', indent: 0, border: true },
                  { label: `Gross Margin`, val: fmtP(metrics.grossMargin), cls: 'text-gray-400', indent: 1 },
                  { label: 'Fixed Operating Expenses', val: `(${$$(fixedCosts)})`, cls: 'text-red-500', indent: 1 },
                  { label: 'Variable Costs (COGS)', val: `(${$$(variableCosts)})`, cls: 'text-red-500', indent: 1 },
                  { label: 'EBITDA', val: $$(ebitda), cls: ebitda >= 0 ? 'text-emerald-700' : 'text-red-600', indent: 0, border: true },
                  { label: 'Net Income', val: $$(metrics.netIncome), cls: metrics.netIncome >= 0 ? 'text-emerald-700 font-bold text-sm' : 'text-red-700 font-bold text-sm', indent: 0, border: true },
                  { label: 'Net Margin', val: fmtP(metrics.netMargin), cls: 'text-gray-400', indent: 1 },
                ].map(({ label, val, cls, indent, border }) => (
                  <div key={label} className={`flex justify-between py-1 ${border ? 'border-t border-gray-200 mt-1 pt-2' : ''}`}>
                    <span className={`text-gray-500 ${indent ? 'pl-4' : 'font-semibold text-np-dark'}`}>{label}</span>
                    <span className={cls}>{val}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}


      {/* ──── BALANCE SHEET TAB ─────────────────────────────────── */}
      {!loading && tab === 'balance-sheet' && (() => {
        const totalCurrentAssets  = (settings.cash_on_hand || 0) + (settings.accounts_receivable || 0)
        const totalFixedAssets    = settings.equipment_value || 0
        const totalAssets         = totalCurrentAssets + totalFixedAssets
        const totalCurrentLiab    = (settings.accounts_payable || 0) + (settings.deferred_revenue || 0) + (settings.short_term_debt || 0)
        const totalLongTermLiab   = settings.long_term_debt || 0
        const totalLiabilities    = totalCurrentLiab + totalLongTermLiab
        const workingCapital      = totalCurrentAssets - totalCurrentLiab
        const netEquity           = totalAssets - totalLiabilities
        const debtToEquity        = netEquity > 0 ? totalLiabilities / netEquity : 0

        return (
          <div className="space-y-5 max-w-3xl">
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
              <strong>Manual inputs:</strong> Enter your current balance sheet figures below. These are point-in-time snapshots — update monthly. Cash on Hand syncs from the Goals tab.
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Summary cards */}
              <div className={`rounded-xl p-4 border ${workingCapital >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 flex items-center">Working Capital<InfoTip text="Current Assets minus Current Liabilities. Positive = you can cover short-term obligations. Negative = liquidity risk." /></p>
                <p className={`text-2xl font-bold ${workingCapital >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{$$(workingCapital)}</p>
                <p className="text-xs text-gray-500 mt-1">{workingCapital >= 0 ? '✓ Positive' : '⚠ Negative — short-term risk'}</p>
              </div>
              <div className="rounded-xl p-4 border border-gray-100 bg-white">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 flex items-center">Net Equity (Est.)<InfoTip text="Total Assets minus Total Liabilities. A rough estimate of book value. Not a valuation." /></p>
                <p className={`text-2xl font-bold ${netEquity >= 0 ? 'text-np-dark' : 'text-red-700'}`}>{$$(netEquity)}</p>
                <p className="text-xs text-gray-500 mt-1">Total assets − total liabilities</p>
              </div>
              <div className="rounded-xl p-4 border border-gray-100 bg-white">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 flex items-center">Debt-to-Equity<InfoTip text="Total liabilities divided by net equity. Below 1 is generally healthy. Very high ratios signal financial risk." /></p>
                <p className={`text-2xl font-bold ${debtToEquity <= 1 ? 'text-emerald-700' : debtToEquity <= 2 ? 'text-amber-600' : 'text-red-700'}`}>{netEquity > 0 ? `${debtToEquity.toFixed(2)}x` : '—'}</p>
                <p className="text-xs text-gray-500 mt-1">{debtToEquity <= 1 ? '✓ Healthy' : debtToEquity <= 2 ? '⚠ Moderate' : '⚠ High'}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* ASSETS */}
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-np-dark mb-4 flex items-center gap-2"><TrendingUp className="w-4 h-4 text-emerald-600" />Assets</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Current Assets</p>
                <div className="space-y-3 mb-4">
                  <FInput label="Cash on Hand ($)" type="number" min="0"
                    defaultValue={settings.cash_on_hand || ''}
                    key={`coh-bs-${settings.cash_on_hand}`}
                    onBlur={e => saveSettings({ ...settings, cash_on_hand: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Accounts Receivable ($)" type="number" min="0"
                    defaultValue={settings.accounts_receivable || ''}
                    key={`ar-${settings.accounts_receivable}`}
                    onBlur={e => saveSettings({ ...settings, accounts_receivable: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="flex justify-between text-xs font-semibold border-t border-gray-100 pt-2 mb-4">
                  <span>Total Current Assets</span><span className="text-emerald-700">{$$(totalCurrentAssets)}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Fixed Assets</p>
                <div className="space-y-3 mb-4">
                  <FInput label="Equipment / Hardware Value ($)" type="number" min="0"
                    defaultValue={settings.equipment_value || ''}
                    key={`eq-${settings.equipment_value}`}
                    onBlur={e => saveSettings({ ...settings, equipment_value: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Monthly Depreciation ($)" type="number" min="0"
                    defaultValue={settings.monthly_depreciation || ''}
                    key={`dep-${settings.monthly_depreciation}`}
                    onBlur={e => saveSettings({ ...settings, monthly_depreciation: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Monthly Amortization ($)" type="number" min="0"
                    defaultValue={settings.monthly_amortization || ''}
                    key={`amor-${settings.monthly_amortization}`}
                    onBlur={e => saveSettings({ ...settings, monthly_amortization: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="flex justify-between text-xs font-semibold border-t border-gray-100 pt-2 mb-4">
                  <span>Total Fixed Assets</span><span className="text-emerald-700">{$$(totalFixedAssets)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t-2 border-gray-200 pt-2">
                  <span>TOTAL ASSETS</span><span className="text-emerald-700">{$$(totalAssets)}</span>
                </div>
              </div>

              {/* LIABILITIES */}
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="font-semibold text-np-dark mb-4 flex items-center gap-2"><TrendingDown className="w-4 h-4 text-red-500" />Liabilities</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Current Liabilities</p>
                <div className="space-y-3 mb-4">
                  <FInput label="Accounts Payable ($)" type="number" min="0"
                    defaultValue={settings.accounts_payable || ''}
                    key={`ap-${settings.accounts_payable}`}
                    onBlur={e => saveSettings({ ...settings, accounts_payable: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Deferred Revenue ($)" type="number" min="0"
                    defaultValue={settings.deferred_revenue || ''}
                    key={`dr-${settings.deferred_revenue}`}
                    onBlur={e => saveSettings({ ...settings, deferred_revenue: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Short-Term Debt ($)" type="number" min="0"
                    defaultValue={settings.short_term_debt || ''}
                    key={`std-${settings.short_term_debt}`}
                    onBlur={e => saveSettings({ ...settings, short_term_debt: parseFloat(e.target.value) || 0 })} />
                  <FInput label="Monthly Interest ($)" type="number" min="0"
                    defaultValue={settings.monthly_interest || ''}
                    key={`int-${settings.monthly_interest}`}
                    onBlur={e => saveSettings({ ...settings, monthly_interest: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="flex justify-between text-xs font-semibold border-t border-gray-100 pt-2 mb-4">
                  <span>Total Current Liabilities</span><span className="text-red-600">{$$(totalCurrentLiab)}</span>
                </div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Long-Term Liabilities</p>
                <div className="space-y-3 mb-4">
                  <FInput label="Long-Term Debt / Loans ($)" type="number" min="0"
                    defaultValue={settings.long_term_debt || ''}
                    key={`ltd-${settings.long_term_debt}`}
                    onBlur={e => saveSettings({ ...settings, long_term_debt: parseFloat(e.target.value) || 0 })} />
                </div>
                <div className="flex justify-between text-xs font-semibold border-t border-gray-100 pt-2 mb-4">
                  <span>Total Long-Term Liabilities</span><span className="text-red-600">{$$(totalLongTermLiab)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t-2 border-gray-200 pt-2">
                  <span>TOTAL LIABILITIES</span><span className="text-red-600">{$$(totalLiabilities)}</span>
                </div>
              </div>
            </div>

            {/* Deferred Revenue note */}
            {(settings.deferred_revenue || 0) > 0 && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl px-4 py-3 text-xs text-purple-700">
                <strong>Deferred Revenue note:</strong> You have {$$(settings.deferred_revenue)} in deferred revenue — cash collected but service not yet fully delivered. This is a liability until earned. Common with Mastermind cohorts, memberships, and prepaid programs.
              </div>
            )}
          </div>
        )
      })()}

      {/* ──── UNIT ECONOMICS TAB ─────────────────────────────────── */}
      {!loading && tab === 'unit-economics' && (() => {
        const cogsRate    = metrics.paidIncome > 0 ? metrics.cogsTotal / metrics.paidIncome : 0
        const fixedCosts  = expenses.filter(e => !e.is_cogs).reduce((s, e) => s + e.amount, 0)
        const totalUnits  = income.filter(i => i.status === 'paid').length || 1

        return (
          <div className="space-y-5">
            <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-np-dark mb-1 flex items-center gap-2"><PieChart className="w-4 h-4 text-np-blue" />Unit Economics — What does one sale actually net?</h3>
              <p className="text-xs text-gray-400 mb-4">Based on your current product catalog and this month's COGS rate. COGS rate = total COGS ÷ total revenue.</p>
              {products.filter(p => p.price > 0).length === 0
                ? <p className="text-xs text-gray-400">Add products with prices in the Products tab to see unit economics.</p>
                : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="text-left py-2 px-3 text-gray-500 font-semibold">Product</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Price</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Est. COGS</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Gross Profit</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Gross Margin</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Contrib. Margin</th>
                          <th className="text-right py-2 px-3 text-gray-500 font-semibold">Break-Even Units</th>
                        </tr>
                      </thead>
                      <tbody>
                        {products.filter(p => p.price > 0).map(p => {
                          const unitCogs    = p.price * cogsRate
                          const unitGP      = p.price - unitCogs
                          const unitGM      = p.price > 0 ? (unitGP / p.price) * 100 : 0
                          const unitCM      = unitGP  // contribution margin = gross profit for service businesses
                          const beUnits     = unitCM > 0 ? Math.ceil(fixedCosts / unitCM) : null
                          return (
                            <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-3 px-3 font-medium text-np-dark">{p.name}<span className="text-gray-400 font-normal ml-1">({p.category})</span></td>
                              <td className="py-3 px-3 text-right text-np-dark font-semibold">{$$(p.price)}</td>
                              <td className="py-3 px-3 text-right text-red-500">({$$(unitCogs)})</td>
                              <td className="py-3 px-3 text-right text-emerald-700">{$$(unitGP)}</td>
                              <td className="py-3 px-3 text-right">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${unitGM >= 60 ? 'bg-emerald-100 text-emerald-700' : unitGM >= 40 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>{fmtP(unitGM)}</span>
                              </td>
                              <td className="py-3 px-3 text-right text-np-blue font-semibold">{$$(unitCM)}</td>
                              <td className="py-3 px-3 text-right text-gray-600">{beUnits !== null ? `${beUnits} units` : '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )
              }
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Users className="w-4 h-4 text-purple-600" />Customer Unit Economics</h3>
                <div className="space-y-3 text-xs">
                  {[
                    { label: 'Avg Revenue Per Client (ARPU)', val: clients.length > 0 ? $$(metrics.paidIncome / clients.length) : '—', tip: 'Paid revenue ÷ total clients on record this period.' },
                    { label: 'Customer Acquisition Cost (CAC)', val: settings.avg_cac > 0 ? $$(settings.avg_cac) : 'Set in Goals', tip: 'How much it costs to acquire one new customer.' },
                    { label: 'Customer Lifetime Value (LTV)', val: settings.avg_ltv > 0 ? $$(settings.avg_ltv) : 'Set in Goals', tip: 'Total expected revenue from one customer relationship.' },
                    { label: 'LTV:CAC Ratio', val: settings.avg_cac > 0 && settings.avg_ltv > 0 ? `${(settings.avg_ltv / settings.avg_cac).toFixed(1)}x` : '—', tip: '3x+ is healthy. Below 1x means each customer costs more to acquire than they generate.' },
                    { label: 'Payback Period', val: settings.avg_ltv > 0 && settings.avg_cac > 0 ? `${(settings.avg_cac / (settings.avg_ltv / 12)).toFixed(1)} months` : '—', tip: 'How long until you recover your cost to acquire this customer.' },
                    { label: 'Monthly Churn', val: settings.avg_churn_pct > 0 ? fmtP(settings.avg_churn_pct) : 'Set in Goals', tip: '% of customers who cancel or drop off each month.' },
                  ].map(({ label, val, tip }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-50">
                      <span className="text-gray-500 flex items-center">{label}<InfoTip text={tip} /></span>
                      <span className="font-semibold text-np-dark">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-np-blue" />This Month — Aggregate</h3>
                <div className="space-y-3 text-xs">
                  {[
                    { label: 'Total Paid Revenue', val: $$(metrics.paidIncome) },
                    { label: 'Total Transactions', val: `${income.filter(i=>i.status==='paid').length}` },
                    { label: 'Avg Transaction Value', val: income.filter(i=>i.status==='paid').length > 0 ? $$(metrics.paidIncome / income.filter(i=>i.status==='paid').length) : '—' },
                    { label: 'Total COGS', val: `(${$$(metrics.cogsTotal)})` },
                    { label: 'Gross Profit', val: $$(metrics.grossProfit) },
                    { label: 'Gross Margin', val: fmtP(metrics.grossMargin) },
                    { label: 'Contribution Margin (total)', val: $$(metrics.contribMargin) },
                    { label: 'Contribution Margin %', val: fmtP(metrics.contribMarginPct) },
                    { label: 'Fixed Costs', val: `(${$$(fixedCosts)})` },
                    { label: 'Net Income', val: $$(metrics.netIncome) },
                  ].map(({ label, val }) => (
                    <div key={label} className="flex justify-between py-1.5 border-b border-gray-50">
                      <span className="text-gray-500">{label}</span>
                      <span className="font-semibold text-np-dark">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Cheat Sheet Reference */}
            <div className="bg-np-blue/5 border border-np-blue/10 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" />The Founder Financial Hierarchy</h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs text-gray-600">
                <div>
                  <p className="font-bold text-np-dark mb-2">Can I sell it?</p>
                  <p>Revenue, CAC, conversion rate</p>
                  <p className="font-bold text-np-dark mt-3 mb-2">Can I deliver it profitably?</p>
                  <p>COGS, gross margin, contribution margin, unit economics</p>
                </div>
                <div>
                  <p className="font-bold text-np-dark mb-2">Can I survive long enough to scale?</p>
                  <p>Cash flow, burn rate, runway, working capital</p>
                  <p className="font-bold text-np-dark mt-3 mb-2">Can I grow without losing the company?</p>
                  <p>Valuation, dilution, cap table, financing terms</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-3 border-t border-np-blue/10 pt-3">Revenue tells you demand · Margin tells you efficiency · Cash flow tells you survival · Runway tells you time · Unit economics tells you whether scale helps or hurts</p>
            </div>
          </div>
        )
      })()}


      {/* ──── CAP TABLE TAB ──────────────────────────────────────── */}
      {!loading && tab === 'cap-table' && (() => {
        const totalShares     = capTable.filter(e => ['common','preferred','option'].includes(e.share_class)).reduce((s, e) => s + (e.shares || 0), 0)
        const totalInvested   = capTable.filter(e => e.investment > 0).reduce((s, e) => s + e.investment, 0)
        const monthlyFromCap  = capTable.filter(e => e.monthly_payment > 0).reduce((s, e) => s + e.monthly_payment, 0)
        const founderPct      = capTable.filter(e => e.role === 'founder').reduce((s, e) => s + (e.ownership_pct || 0), 0)
        const investorPct     = capTable.filter(e => ['investor','safe','note'].includes(e.role)).reduce((s, e) => s + (e.ownership_pct || 0), 0)

        const roleColors: Record<string, string> = {
          founder: 'bg-np-blue/10 text-np-blue border-np-blue/20',
          investor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          employee: 'bg-purple-50 text-purple-700 border-purple-200',
          advisor: 'bg-amber-50 text-amber-700 border-amber-200',
          safe: 'bg-orange-50 text-orange-700 border-orange-200',
          note: 'bg-red-50 text-red-700 border-red-200',
        }

        function newEntry(): CapTableEntry {
          return { id: crypto.randomUUID(), name: '', role: 'investor', share_class: 'preferred', shares: 0, ownership_pct: 0, investment: 0, instrument: '', conversion_discount: 0, conversion_cap: 0, monthly_payment: 0, notes: '' }
        }

        function updateEntry(id: string, field: keyof CapTableEntry, value: any) {
          const updated = capTable.map(e => e.id === id ? { ...e, [field]: value } : e)
          setCapTable(updated)
        }

        function removeEntry(id: string) {
          const updated = capTable.filter(e => e.id !== id)
          setCapTable(updated)
          saveCapTable(updated)
        }

        return (
          <div className="space-y-5">
            {/* Summary bar */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">Founder Ownership<InfoTip text="Combined ownership % of all founder entries." /></p>
                <p className="text-2xl font-bold text-np-blue">{founderPct.toFixed(1)}%</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">Investor Ownership<InfoTip text="Combined ownership % of investors, SAFEs, and convertible notes (post-conversion estimate)." /></p>
                <p className="text-2xl font-bold text-emerald-700">{investorPct.toFixed(1)}%</p>
              </div>
              <div className="bg-white border border-gray-100 rounded-xl p-4 shadow-sm">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">Total Raised<InfoTip text="Sum of all investment amounts across all instruments." /></p>
                <p className="text-2xl font-bold text-np-dark">{$$(totalInvested)}</p>
              </div>
              <div className={`rounded-xl p-4 border shadow-sm ${monthlyFromCap > 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-100'}`}>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 flex items-center">Monthly Investment Income<InfoTip text="Total recurring monthly payments from investors. These flow into your income ledger automatically when you mark them paid." /></p>
                <p className={`text-2xl font-bold ${monthlyFromCap > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>{monthlyFromCap > 0 ? $$(monthlyFromCap) : '—'}</p>
                <p className="text-xs text-gray-500 mt-1">per month</p>
              </div>
            </div>

            {/* Ownership visual bar */}
            {capTable.length > 0 && (
              <div className="bg-white border border-gray-100 rounded-xl p-5 shadow-sm">
                <h3 className="text-sm font-semibold text-np-dark mb-3">Ownership Breakdown</h3>
                <div className="h-6 rounded-full overflow-hidden flex mb-3">
                  {capTable.filter(e => e.ownership_pct > 0).sort((a,b) => b.ownership_pct - a.ownership_pct).map((e, i) => {
                    const colors = ['#386797','#2A9D8F','#8B5CF6','#F59E0B','#EF4444','#10B981','#6366F1','#EC4899']
                    return <div key={e.id} title={`${e.name}: ${e.ownership_pct}%`} style={{ width: `${Math.min(e.ownership_pct, 100)}%`, backgroundColor: colors[i % colors.length] }} />
                  })}
                  {100 - capTable.reduce((s,e) => s + (e.ownership_pct||0), 0) > 0 && (
                    <div className="flex-1 bg-gray-100" title="Unallocated" />
                  )}
                </div>
                <div className="flex flex-wrap gap-3">
                  {capTable.filter(e => e.ownership_pct > 0).map((e, i) => {
                    const colors = ['#386797','#2A9D8F','#8B5CF6','#F59E0B','#EF4444','#10B981','#6366F1','#EC4899']
                    return (
                      <div key={e.id} className="flex items-center gap-1.5 text-xs">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[i % colors.length] }} />
                        <span className="font-medium text-np-dark">{e.name || 'Unnamed'}</span>
                        <span className="text-gray-400">{e.ownership_pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Cap table entries */}
            <div className="bg-white border border-gray-100 rounded-xl shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h3 className="font-semibold text-np-dark flex items-center gap-2"><Shield className="w-4 h-4 text-np-blue" />Cap Table Entries</h3>
                <Btn size="xs" onClick={() => {
                  const e = newEntry()
                  const updated = [...capTable, e]
                  setCapTable(updated)
                  setCapEditing(e.id)
                }}>
                  <Plus className="w-3.5 h-3.5" />Add Entry
                </Btn>
              </div>

              {capTable.length === 0 && (
                <div className="py-10 text-center text-sm text-gray-400">
                  No cap table entries yet. Add founders, investors, SAFEs, and convertible notes.
                </div>
              )}

              <div className="divide-y divide-gray-50">
                {capTable.map(entry => (
                  <div key={entry.id} className="px-5 py-4">
                    {capEditing === entry.id ? (
                      // Edit mode
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <FInput label="Name" value={entry.name} onChange={e => updateEntry(entry.id, 'name', e.target.value)} placeholder="e.g. Cameron Allen" />
                          <FSelect label="Role" value={entry.role} onChange={e => updateEntry(entry.id, 'role', e.target.value)}>
                            <option value="founder">Founder</option>
                            <option value="investor">Investor</option>
                            <option value="safe">SAFE</option>
                            <option value="note">Convertible Note</option>
                            <option value="employee">Employee (Option)</option>
                            <option value="advisor">Advisor</option>
                          </FSelect>
                          <FSelect label="Instrument / Share Class" value={entry.share_class} onChange={e => updateEntry(entry.id, 'share_class', e.target.value)}>
                            <option value="common">Common Stock</option>
                            <option value="preferred">Preferred Stock</option>
                            <option value="option">Stock Option</option>
                            <option value="safe">SAFE</option>
                            <option value="convertible_note">Convertible Note</option>
                            <option value="warrant">Warrant</option>
                          </FSelect>
                          <FInput label="Shares" type="number" min="0" value={String(entry.shares || '')} onChange={e => updateEntry(entry.id, 'shares', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <FInput label="Ownership %" type="number" min="0" max="100" step="0.01" value={String(entry.ownership_pct || '')} onChange={e => updateEntry(entry.id, 'ownership_pct', parseFloat(e.target.value) || 0)} />
                          <FInput label="Investment Amount ($)" type="number" min="0" value={String(entry.investment || '')} onChange={e => updateEntry(entry.id, 'investment', parseFloat(e.target.value) || 0)} />
                          <FInput label="Conversion Discount (%)" type="number" min="0" max="100" value={String(entry.conversion_discount || '')} onChange={e => updateEntry(entry.id, 'conversion_discount', parseFloat(e.target.value) || 0)} placeholder="e.g. 20" />
                          <FInput label="Valuation Cap ($)" type="number" min="0" value={String(entry.conversion_cap || '')} onChange={e => updateEntry(entry.id, 'conversion_cap', parseFloat(e.target.value) || 0)} placeholder="e.g. 1000000" />
                        </div>
                        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                          <FInput label="Monthly Payment ($)" type="number" min="0" step="0.01" value={String(entry.monthly_payment || '')} onChange={e => updateEntry(entry.id, 'monthly_payment', parseFloat(e.target.value) || 0)} placeholder="0 if none" />
                          <FInput label="Instrument Label" value={entry.instrument} onChange={e => updateEntry(entry.id, 'instrument', e.target.value)} placeholder="e.g. YC-style SAFE, Seed Round" />
                          <FInput label="Notes" value={entry.notes} onChange={e => updateEntry(entry.id, 'notes', e.target.value)} placeholder="Optional" />
                        </div>
                        <div className="flex justify-end gap-2">
                          <Btn variant="secondary" size="xs" onClick={() => setCapEditing(null)}>Cancel</Btn>
                          <Btn size="xs" onClick={() => { saveCapTable(capTable); setCapEditing(null) }}>Save Entry</Btn>
                        </div>
                      </div>
                    ) : (
                      // View mode
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-semibold text-np-dark text-sm">{entry.name || '(unnamed)'}</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${roleColors[entry.role] || 'bg-gray-100 text-gray-600 border-gray-200'}`}>{entry.role.toUpperCase()}</span>
                              {entry.share_class && <span className="text-[10px] text-gray-400">{entry.share_class.replace('_',' ')}</span>}
                            </div>
                            <div className="flex items-center gap-4 text-xs text-gray-500">
                              {entry.ownership_pct > 0 && <span className="font-semibold text-np-dark">{entry.ownership_pct}%</span>}
                              {entry.shares > 0 && <span>{entry.shares.toLocaleString()} shares</span>}
                              {entry.investment > 0 && <span className="text-emerald-700">{$$(entry.investment)} invested</span>}
                              {entry.conversion_discount > 0 && <span className="text-orange-600">{entry.conversion_discount}% discount</span>}
                              {entry.conversion_cap > 0 && <span className="text-orange-600">{$$(entry.conversion_cap)} cap</span>}
                              {entry.monthly_payment > 0 && <span className="text-emerald-700 font-semibold">{$$(entry.monthly_payment)}/mo</span>}
                              {entry.instrument && <span className="text-gray-400">· {entry.instrument}</span>}
                            </div>
                            {entry.notes && <p className="text-xs text-gray-400 mt-0.5">{entry.notes}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-4">
                          <button onClick={() => setCapEditing(entry.id)} className="p-1.5 text-gray-400 hover:text-np-blue hover:bg-np-blue/5 rounded-lg transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => removeEntry(entry.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Dilution context */}
            {capTable.some(e => ['safe','note'].includes(e.role)) && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
                <strong>SAFE / Note dilution:</strong> The ownership percentages above are your estimates. SAFEs and convertible notes convert into equity at a future priced round — typically at a discount to the round price or at the valuation cap (whichever gives the investor more shares). The Scenario Coach can model your dilution across conversion scenarios.
              </div>
            )}

            {/* Monthly investment income summary */}
            {monthlyFromCap > 0 && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 text-xs text-emerald-700">
                <strong>{$$(monthlyFromCap)}/month in investor payments</strong> — add these each month using Add Income → Income Category: Investment. They will appear separately from client revenue in your P&L so you can see true operating revenue vs. capital-sourced cash.
              </div>
            )}
          </div>
        )
      })()}

      {/* ══════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════ */}

      {/* Income modal */}
      {showIncomeModal && (
        <IncomeModal
          products={products}
          clients={clients}
          initial={editIncome}
          onSave={saveIncome}
          onClose={() => { setShowIncomeModal(false); setEditIncome(null); setSaveError('') }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Expense modal */}
      {showExpenseModal && (
        <ExpenseModal
          categories={categories}
          initial={editExpense}
          onSave={saveExpense}
          onClose={() => { setShowExpenseModal(false); setEditExpense(null); setSaveError('') }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Client modal */}
      {showClientModal && (
        <ClientModal
          initial={editClient}
          onSave={saveClient}
          onClose={() => { setShowClientModal(false); setEditClient(null); setSaveError('') }}
          saving={saving}
          saveError={saveError}
        />
      )}

      {/* Product modal */}
      {showProductModal && (
        <ProductModal
          initial={editProduct}
          onSave={saveProduct}
          onClose={() => { setShowProductModal(false); setEditProduct(null); setSaveError('') }}
          saving={saving}
          saveError={saveError}
        />
      )}

    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Modal Components
// ═══════════════════════════════════════════════════════════════

function IncomeModal({ saving = false, saveError = '', products, clients, initial, onSave, onClose }: {
  products: Product[]; clients: FinClient[]; initial: Income | null
  onSave: (d: any) => Promise<void>; onClose: () => void; saving?: boolean; saveError?: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    txn_date:     initial?.txn_date     || today,
    client_name:  initial?.client_name  || '',
    product_id:   '',
    product_name: initial?.product_name || '',
    amount:       String(initial?.amount  || ''),
    status:       initial?.status        || 'paid',
    notes:        initial?.notes         || '',
    income_category: (initial as any)?.income_category || '',
  })
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))
  async function submit() {
    if (!form.amount || !form.txn_date) { alert('Date and amount are required'); return }
    await onSave({ ...form, source: form.income_category === 'investment' ? 'investment' : 'manual' })
  }
  return (
    <Modal title={initial ? 'Edit Income' : 'Add Income'} onClose={onClose}>
      <div className="space-y-3">
        <FInput label="Date" type="date" value={form.txn_date} onChange={set('txn_date')} />
        <FSelect label="Client" value={form.client_name} onChange={set('client_name')}>
          <option value="">— select or type below —</option>
          {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </FSelect>
        <FInput label="Client Name (if not in list)" value={form.client_name} onChange={set('client_name')} placeholder="Or type a name" />
        <FSelect label="Product" value={form.product_id} onChange={e => {
          const p = products.find(p => p.id === e.target.value)
          setForm(f => ({ ...f, product_id: e.target.value, product_name: p?.name || f.product_name, amount: p?.price ? String(p.price) : f.amount }))
        }}>
          <option value="">— select product —</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.price > 0 ? `($${p.price})` : ''}</option>)}
        </FSelect>
        <FInput label="Product / Description" value={form.product_name} onChange={set('product_name')} placeholder="Or describe manually" />
        <FInput label="Amount ($)" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
        <FSelect label="Income Category" value={form.income_category || ''} onChange={set('income_category')}>
          <option value="">— Client / Service Revenue —</option>
          <option value="investment">Investment — Monthly Payment</option>
          <option value="grant">Grant</option>
          <option value="loan_proceeds">Loan Proceeds</option>
          <option value="other">Other</option>
        </FSelect>
        <FSelect label="Status" value={form.status} onChange={set('status')}>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="disputed">Disputed</option>
        </FSelect>
        <FInput label="Notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
        {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ExpenseModal({ saving = false, saveError = '', categories, initial, onSave, onClose }: {
  categories: ExpCat[]; initial: Expense | null
  onSave: (d: any) => Promise<void>; onClose: () => void; saving?: boolean; saveError?: string
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    txn_date:      initial?.txn_date      || today,
    vendor:        initial?.vendor        || '',
    category_id:   '',
    category_name: initial?.category_name || '',
    group_name:    initial?.group_name    || '',
    is_cogs:       initial?.is_cogs       || false,
    amount:        String(initial?.amount || ''),
    status:        initial?.status        || 'paid',
    recurring:     initial?.recurring     || false,
    notes:         initial?.notes         || '',
  })
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))

  // Group categories
  const catGroups = useMemo(() => {
    const g: Record<string, ExpCat[]> = {}
    categories.forEach(c => { if (!g[c.group_name]) g[c.group_name] = []; g[c.group_name].push(c) })
    return g
  }, [categories])

  async function submit() {
    if (!form.vendor || !form.amount) { alert('Vendor and amount are required'); return }
    await onSave(form)
  }

  return (
    <Modal title={initial ? 'Edit Expense' : 'Add Expense'} onClose={onClose}>
      <div className="space-y-3">
        <FInput label="Date" type="date" value={form.txn_date} onChange={set('txn_date')} />
        <FInput label="Vendor / Payee" value={form.vendor} onChange={set('vendor')} placeholder="e.g. Amazon, Landlord, etc." />
        <FSelect label="Category" value={form.category_id} onChange={e => {
          const cat = categories.find(c => c.id === e.target.value)
          setForm(f => ({ ...f, category_id: e.target.value, category_name: cat?.name || '', group_name: cat?.group_name || '', is_cogs: cat?.is_cogs || false }))
        }}>
          <option value="">— select category —</option>
          {Object.entries(catGroups).map(([grp, cats]) => (
            <optgroup key={grp} label={grp}>
              {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </optgroup>
          ))}
        </FSelect>
        <FInput label="Amount ($)" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
        <FSelect label="Status" value={form.status} onChange={set('status')}>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="overdue">Overdue</option>
        </FSelect>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.recurring} onChange={e => setForm(f => ({ ...f, recurring: e.target.checked }))} className="rounded" />
            <span className="text-gray-600">Recurring</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_cogs} onChange={e => setForm(f => ({ ...f, is_cogs: e.target.checked }))} className="rounded" />
            <span className="text-gray-600">COGS</span>
          </label>
        </div>
        <FInput label="Notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
        {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
          <button onClick={submit} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ClientModal({ saving = false, saveError = '', initial, onSave, onClose }: {
  initial: FinClient | null; onSave: (d: any) => Promise<void>; onClose: () => void; saving?: boolean; saveError?: string
}) {
  const [form, setForm] = useState({
    name: initial?.name || '', email: initial?.email || '',
    phone: initial?.phone || '', notes: initial?.notes || '',
    contract_value: String(initial?.contract_value || ''),
  })
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))
  return (
    <Modal title={initial ? 'Edit Client' : 'Add Client'} onClose={onClose}>
      <div className="space-y-3">
        <FInput label="Name *" value={form.name} onChange={set('name')} />
        <FInput label="Email" type="email" value={form.email} onChange={set('email')} />
        <FInput label="Phone" type="tel" value={form.phone} onChange={set('phone')} />
        <FInput label="Contract Value ($)" type="number" min="0" step="0.01" value={form.contract_value} onChange={set('contract_value')} />
        <FInput label="Notes" value={form.notes} onChange={set('notes')} />
        {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
          <button onClick={async () => { if (!form.name) { alert('Name required'); return }; await onSave(form) }} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ProductModal({ saving = false, saveError = '', initial, onSave, onClose }: {
  initial: Product | null; onSave: (d: any) => Promise<void>; onClose: () => void; saving?: boolean; saveError?: string
}) {
  const [form, setForm] = useState({
    name: initial?.name || '', category: initial?.category || '',
    price: String(initial?.price || ''), sort_order: String(initial?.sort_order || '999'),
  })
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))
  return (
    <Modal title={initial ? 'Edit Product' : 'Add Product'} onClose={onClose}>
      <div className="space-y-3">
        <FInput label="Product Name *" value={form.name} onChange={set('name')} />
        <FInput label="Category" value={form.category} onChange={set('category')} placeholder="e.g. Program, Session, Subscription" />
        <FInput label="Default Price ($)" type="number" min="0" step="0.01" value={form.price} onChange={set('price')} />
        {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={saving} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100 disabled:opacity-50">Cancel</button>
          <button onClick={async () => { if (!form.name) { alert('Name required'); return }; await onSave(form) }} disabled={saving} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg disabled:opacity-50 flex items-center gap-2">
            {saving && <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

