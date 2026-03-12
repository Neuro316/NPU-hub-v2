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
} from 'lucide-react'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
interface OrgSummary  { id: string; name: string; slug: string }
interface FinSettings { target_gross_margin: number; target_net_margin: number; fiscal_year_start_month: number; currency: string }
interface Product     { id: string; name: string; category: string; price: number; sort_order: number }
interface ExpCat      { id: string; group_name: string; name: string; is_cogs: boolean; sort_order: number }
interface FinClient   { id: string; name: string; email: string; phone: string; notes: string; contract_value: number }
interface Income      {
  id: string; txn_date: string; period_month: string
  client_name: string | null; product_name: string | null
  amount: number; status: 'paid'|'pending'|'refunded'|'disputed'
  source: 'manual'|'stripe'|'np_platform'; stripe_payment_id: string | null
  notes: string | null
}
interface Expense {
  id: string; txn_date: string; period_month: string; vendor: string
  category_name: string | null; group_name: string | null; is_cogs: boolean
  amount: number; status: 'paid'|'pending'|'overdue'; recurring: boolean; notes: string | null
}

// â”€â”€â”€ Utils â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Sub-components â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Main Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function FinancePage() {
  const { role } = usePermissions()
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const isSuperAdmin = role === 'super_admin'

  // â”€â”€ Org resolution: follows master org switcher in sidebar â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const selectedOrg = currentOrg as OrgSummary | null
  const isNP = useMemo(() => selectedOrg?.slug?.toLowerCase().includes('neuro') || selectedOrg?.slug?.toLowerCase().includes('progeny'), [selectedOrg])
  const orgColor = isNP ? '#386797' : '#2A9D8F'

  // â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [tab,      setTab]     = useState<'dashboard'|'income'|'expenses'|'clients'|'products'|'reports'|'settings'|'ai-cfo'>('ai-cfo')
  const [month,    setMonth]   = useState(curMonth)
  const [loading,  setLoading] = useState(false)
  const [syncing,  setSyncing] = useState(false)
  const [search,   setSearch]  = useState('')

  const [income,     setIncome]     = useState<Income[]>([])
  const [expenses,   setExpenses]   = useState<Expense[]>([])
  const [clients,    setClients]    = useState<FinClient[]>([])
  const [products,   setProducts]   = useState<Product[]>([])
  const [categories, setCategories] = useState<ExpCat[]>([])
  const [settings,   setSettings]   = useState<FinSettings>({ target_gross_margin: 60, target_net_margin: 30, fiscal_year_start_month: 1, currency: 'usd' })
  const [aiText,     setAiText]     = useState('')
  const [aiStreaming, setAiStreaming] = useState(false)

  // Modal states
  const [showIncomeModal,  setShowIncomeModal]  = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [showClientModal,  setShowClientModal]  = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)
  const [editIncome,       setEditIncome]       = useState<Income | null>(null)
  const [editExpense,      setEditExpense]       = useState<Expense | null>(null)
  const [editClient,       setEditClient]        = useState<FinClient | null>(null)
  const [editProduct,      setEditProduct]       = useState<Product | null>(null)

  // â”€â”€ Load data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      if (setData.settings) setSettings(setData.settings)

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

  // â”€â”€ Sync NP platform payments â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Derived metrics â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    return { paidIncome, pendingIncome, cogsTotal, totalExp, grossProfit, netIncome, grossMargin, netMargin, topGroups, topProducts }
  }, [income, expenses])

  // â”€â”€ Filtered views â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const filteredIncome   = useMemo(() => income.filter(i => !search || [i.client_name, i.product_name, i.notes].join(' ').toLowerCase().includes(search.toLowerCase())), [income, search])
  const filteredExpenses = useMemo(() => expenses.filter(e => !search || [e.vendor, e.category_name, e.notes].join(' ').toLowerCase().includes(search.toLowerCase())), [expenses, search])
  const filteredClients  = useMemo(() => clients.filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase())), [clients, search])

  // â”€â”€ Group expenses for display â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const expensesByGroup = useMemo(() => {
    const grps: Record<string, Expense[]> = {}
    filteredExpenses.forEach(e => { const g = e.group_name || 'Other'; if (!grps[g]) grps[g] = []; grps[g].push(e) })
    return Object.entries(grps).sort((a, b) => b[1].reduce((s, e) => s + e.amount, 0) - a[1].reduce((s, e) => s + e.amount, 0))
  }, [filteredExpenses])

  // â”€â”€ CRUD operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async function saveIncome(data: Record<string, any>) {
    if (!selectedOrg) return
    const method = editIncome ? 'PUT' : 'POST'
    const body   = editIncome ? { id: editIncome.id, org_id: selectedOrg.id, ...data } : { org_id: selectedOrg.id, ...data }
    const res = await fetch('/api/finance/income', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { await loadData(); setShowIncomeModal(false); setEditIncome(null) }
    else { const e = await res.json(); alert(e.error) }
  }

  async function deleteIncome(id: string) {
    if (!selectedOrg || !confirm('Delete this income record?')) return
    await fetch(`/api/finance/income?id=${id}&org_id=${selectedOrg.id}`, { method: 'DELETE' })
    await loadData()
  }

  async function saveExpense(data: Record<string, any>) {
    if (!selectedOrg) return
    const method = editExpense ? 'PUT' : 'POST'
    const body   = editExpense ? { id: editExpense.id, org_id: selectedOrg.id, ...data } : { org_id: selectedOrg.id, ...data }
    const res = await fetch('/api/finance/expenses', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { await loadData(); setShowExpenseModal(false); setEditExpense(null) }
    else { const e = await res.json(); alert(e.error) }
  }

  async function deleteExpense(id: string) {
    if (!selectedOrg || !confirm('Delete this expense?')) return
    await fetch(`/api/finance/expenses?id=${id}&org_id=${selectedOrg.id}`, { method: 'DELETE' })
    await loadData()
  }

  async function saveClient(data: Record<string, any>) {
    if (!selectedOrg) return
    const method = editClient ? 'PUT' : 'POST'
    const body   = editClient ? { id: editClient.id, org_id: selectedOrg.id, ...data } : { org_id: selectedOrg.id, ...data }
    const res = await fetch('/api/finance/clients', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { await loadData(); setShowClientModal(false); setEditClient(null) }
    else { const e = await res.json(); alert(e.error) }
  }

  async function saveProduct(data: Record<string, any>) {
    if (!selectedOrg) return
    const method = editProduct ? 'PUT' : 'POST'
    const body   = editProduct ? { id: editProduct.id, org_id: selectedOrg.id, ...data } : { org_id: selectedOrg.id, ...data }
    const res = await fetch('/api/finance/products', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    if (res.ok) { await loadData(); setShowProductModal(false); setEditProduct(null) }
    else { const e = await res.json(); alert(e.error) }
  }

  async function saveSettings(data: Partial<FinSettings>) {
    if (!selectedOrg) return
    const res = await fetch('/api/finance/settings', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org_id: selectedOrg.id, ...data }),
    })
    if (res.ok) { const d = await res.json(); setSettings(d.settings) }
  }

  // â”€â”€ AI CFO stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ CSV Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Guard: super admin only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="max-w-[1200px] mx-auto space-y-4">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-np-dark">Financial Intelligence</h1>
          <p className="text-sm text-gray-500 mt-0.5">P&amp;L Â· Income Â· Expenses Â· AI CFO Analysis</p>
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
        {(['dashboard','income','expenses','clients','products','reports','settings','ai-cfo'] as const).map(t => {
          const icons: Record<string, any> = { dashboard: BarChart3, income: TrendingUp, expenses: TrendingDown, clients: Users, products: Tag, reports: FileText, settings: Settings, 'ai-cfo': Brain }
          const labels: Record<string, string> = { dashboard: 'Dashboard', income: 'Income', expenses: 'Expenses', clients: 'Clients', products: 'Products', reports: 'Reports', settings: 'Settings', 'ai-cfo': 'ðŸ§  AI CFO' }
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

      {/* â”€â”€â”€â”€ DASHBOARD TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'dashboard' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tip="Total paid & collected income for this period. Excludes pending and refunded transactions." label="Gross Revenue" value={$$(metrics.paidIncome)} color="text-emerald-700" />
            <Stat tip="Income recorded but not yet received â€” invoices sent, payments in process, or future-dated charges." label="Pending / Uncollected" value={$$(metrics.pendingIncome)} color="text-amber-600" />
            <Stat tip="All costs for this period including COGS (direct service costs) and operating expenses." label="Total Expenses" value={$$(metrics.totalExp)} color="text-red-600" />
            <Stat tip="What remains after all expenses. Gross Revenue minus Total Expenses. Negative = operating at a loss." label="Net Income" value={$$(metrics.netIncome)} color={metrics.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'} />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat tip="Cost of Goods Sold â€” direct costs tied to delivering your services (e.g. platform fees, contractor pay, supplies)." label="COGS" value={$$(metrics.cogsTotal)} />
            <Stat tip="Revenue minus COGS only. Shows how profitable your core services are before overhead is factored in." label="Gross Profit" value={$$(metrics.grossProfit)} color="text-np-blue" />
            <Stat tip="Gross Profit as a % of Revenue. Measures service profitability. Your target is set in Settings." label="Gross Margin" value={fmtP(metrics.grossMargin)} color={metrics.grossMargin >= settings.target_gross_margin ? 'text-emerald-600' : 'text-amber-600'} />
            <Stat tip="Net Income as a % of Revenue. The bottom line â€” how much of every dollar earned you actually keep. Your target is set in Settings." label="Net Margin" value={fmtP(metrics.netMargin)} color={metrics.netMargin >= settings.target_net_margin ? 'text-emerald-600' : 'text-amber-600'} />
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
              <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center">Income Statement<InfoTip text="Standard P&L summary: Revenue â†’ minus COGS â†’ Gross Profit â†’ minus Operating Expenses â†’ Net Income." /></h3>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-600">Gross Revenue</span><span className="font-semibold text-emerald-700">{$$(metrics.paidIncome)}</span></div>
                <div className="flex justify-between"><span className="text-gray-600 pl-3">â€” Cost of Goods Sold</span><span className="text-red-500">({$$(metrics.cogsTotal)})</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5"><span className="font-semibold text-np-dark">Gross Profit</span><span className="font-bold" style={{ color: orgColor }}>{$$(metrics.grossProfit)} <span className="text-gray-400 font-normal">({fmtP(metrics.grossMargin)})</span></span></div>
                <div className="flex justify-between mt-1"><span className="text-gray-600 pl-3">â€” Operating Expenses</span><span className="text-red-500">({$$(metrics.totalExp - metrics.cogsTotal)})</span></div>
                <div className="flex justify-between border-t border-gray-100 pt-1.5 mt-1.5"><span className="font-bold text-np-dark">Net Income</span><span className={`font-bold ${metrics.netIncome >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{$$(metrics.netIncome)} <span className="text-gray-400 font-normal">({fmtP(metrics.netMargin)})</span></span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* â”€â”€â”€â”€ INCOME TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'income' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search incomeâ€¦" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
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
                      <td className="px-4 py-2.5 text-xs font-medium text-np-dark max-w-[140px] truncate">{i.client_name || 'â€”'}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-600 max-w-[140px] truncate">{i.product_name || 'â€”'}</td>
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

      {/* â”€â”€â”€â”€ EXPENSES TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'expenses' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search expensesâ€¦" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
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
                          <td className="px-4 py-2 text-xs text-gray-500 hidden md:table-cell">{e.category_name || 'â€”'}</td>
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

      {/* â”€â”€â”€â”€ CLIENTS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'clients' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search clientsâ€¦" className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/30" />
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

      {/* â”€â”€â”€â”€ PRODUCTS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'products' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-500">Products and services for {selectedOrg?.name} â€” used when recording income.</p>
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
                        <span className="text-sm font-bold text-np-blue">{p.price > 0 ? $c(p.price) : 'â€”'}</span>
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

      {/* â”€â”€â”€â”€ REPORTS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'reports' && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-np-dark">P&amp;L Statement â€” {moLabel(month)}</h3>
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

      {/* â”€â”€â”€â”€ SETTINGS TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
            <p className="text-[10px] text-gray-400">Events: checkout.session.completed Â· payment_intent.succeeded Â· invoice.payment_succeeded Â· charge.refunded Â· payment_intent.payment_failed</p>
            <p className="text-[10px] text-gray-400 mt-1">Set <code className="bg-gray-100 px-1 rounded">{isNP ? 'STRIPE_WEBHOOK_SECRET' : 'SENSORIUM_STRIPE_WEBHOOK_SECRET'}</code> in Vercel env vars.</p>
          </div>
        </div>
      )}

      {/* â”€â”€â”€â”€ AI CFO TAB â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      {!loading && tab === 'ai-cfo' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-np-dark flex items-center gap-2"><Brain className="w-4 h-4 text-np-blue" /> AI CFO â€” Monthly Analysis</h3>
              <p className="text-xs text-gray-500">Claude acts as your CFO â€” reviews P&L, flags margin risks, and gives you one priority action for the month.</p>
            </div>
            <Btn onClick={runAiCfo} disabled={aiStreaming || metrics.paidIncome === 0}>
              <Zap className={`w-3.5 h-3.5 ${aiStreaming ? 'animate-pulse' : ''}`} />
              {aiStreaming ? 'Analyzingâ€¦' : aiText ? 'Re-run Analysis' : 'Run Analysis'}
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

      {/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
          MODALS
      â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */}

      {/* Income modal */}
      {showIncomeModal && (
        <IncomeModal
          products={products}
          clients={clients}
          initial={editIncome}
          onSave={saveIncome}
          onClose={() => { setShowIncomeModal(false); setEditIncome(null) }}
        />
      )}

      {/* Expense modal */}
      {showExpenseModal && (
        <ExpenseModal
          categories={categories}
          initial={editExpense}
          onSave={saveExpense}
          onClose={() => { setShowExpenseModal(false); setEditExpense(null) }}
        />
      )}

      {/* Client modal */}
      {showClientModal && (
        <ClientModal
          initial={editClient}
          onSave={saveClient}
          onClose={() => { setShowClientModal(false); setEditClient(null) }}
        />
      )}

      {/* Product modal */}
      {showProductModal && (
        <ProductModal
          initial={editProduct}
          onSave={saveProduct}
          onClose={() => { setShowProductModal(false); setEditProduct(null) }}
        />
      )}

    </div>
  )
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// Modal Components
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

function IncomeModal({ products, clients, initial, onSave, onClose }: {
  products: Product[]; clients: FinClient[]; initial: Income | null
  onSave: (d: any) => Promise<void>; onClose: () => void
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
  })
  const set = (k: string) => (e: React.ChangeEvent<any>) => setForm(p => ({ ...p, [k]: e.target.value }))
  async function submit() {
    if (!form.amount || !form.txn_date) { alert('Date and amount are required'); return }
    await onSave(form)
  }
  return (
    <Modal title={initial ? 'Edit Income' : 'Add Income'} onClose={onClose}>
      <div className="space-y-3">
        <FInput label="Date" type="date" value={form.txn_date} onChange={set('txn_date')} />
        <FSelect label="Client" value={form.client_name} onChange={set('client_name')}>
          <option value="">â€” select or type below â€”</option>
          {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
        </FSelect>
        <FInput label="Client Name (if not in list)" value={form.client_name} onChange={set('client_name')} placeholder="Or type a name" />
        <FSelect label="Product" value={form.product_id} onChange={e => {
          const p = products.find(p => p.id === e.target.value)
          setForm(f => ({ ...f, product_id: e.target.value, product_name: p?.name || f.product_name, amount: p?.price ? String(p.price) : f.amount }))
        }}>
          <option value="">â€” select product â€”</option>
          {products.map(p => <option key={p.id} value={p.id}>{p.name} {p.price > 0 ? `($${p.price})` : ''}</option>)}
        </FSelect>
        <FInput label="Product / Description" value={form.product_name} onChange={set('product_name')} placeholder="Or describe manually" />
        <FInput label="Amount ($)" type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} />
        <FSelect label="Status" value={form.status} onChange={set('status')}>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="refunded">Refunded</option>
          <option value="disputed">Disputed</option>
        </FSelect>
        <FInput label="Notes" value={form.notes} onChange={set('notes')} placeholder="Optional" />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100 transition-colors">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg transition-colors">Save</button>
        </div>
      </div>
    </Modal>
  )
}

function ExpenseModal({ categories, initial, onSave, onClose }: {
  categories: ExpCat[]; initial: Expense | null
  onSave: (d: any) => Promise<void>; onClose: () => void
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
          <option value="">â€” select category â€”</option>
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
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={submit} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg">Save</button>
        </div>
      </div>
    </Modal>
  )
}

function ClientModal({ initial, onSave, onClose }: {
  initial: FinClient | null; onSave: (d: any) => Promise<void>; onClose: () => void
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
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={async () => { if (!form.name) { alert('Name required'); return }; await onSave(form) }} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg">Save</button>
        </div>
      </div>
    </Modal>
  )
}

function ProductModal({ initial, onSave, onClose }: {
  initial: Product | null; onSave: (d: any) => Promise<void>; onClose: () => void
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
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-np-dark rounded-lg hover:bg-gray-100">Cancel</button>
          <button onClick={async () => { if (!form.name) { alert('Name required'); return }; await onSave(form) }} className="px-4 py-2 text-sm font-semibold text-white bg-np-blue hover:bg-np-blue/90 rounded-lg">Save</button>
        </div>
      </div>
    </Modal>
  )
}

