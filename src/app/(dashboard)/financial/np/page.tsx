'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  DollarSign, Users, TrendingUp, Plus, X, Search, BarChart3,
  LayoutDashboard, Wallet, Trash2, Pencil, ArrowRight, ChevronDown,
  ChevronUp, Link2, FileText, AlertTriangle, CheckCircle2, Clock,
  Send, Download, RefreshCw, UserPlus, Receipt, Calculator
} from 'lucide-react'

// ═══ Types ═══════════════════════════════════════════════════
interface RateConfig { id: string; org_id: string; target_type: string; target_id: string | null; rate_type: string; rate_value: number; applies_to: string; effective_from: string; effective_until: string | null; cohort_id: string | null; notes: string; created_at: string }
interface AffiliatePartner { id: string; org_id: string; name: string; email: string; phone: string; referral_code: string; commission_type: string; commission_value: number; commission_duration: string; commission_duration_months: number | null; tier: string; status: string; total_referrals: number; total_earned: number; total_paid: number; tax_id: string; w9_on_file: boolean; notes: string; created_at: string }
interface AffiliateReferral { id: string; affiliate_id: string; referral_code: string; referred_email: string; referred_name: string; enrollment_id: string | null; status: string; clicked_at: string; enrolled_at: string | null }
interface CommissionEntry { id: string; affiliate_id: string; payment_id: string; payout_id: string | null; entry_type: string; amount: number; note: string; created_at: string }
interface Payout { id: string; org_id: string; recipient_type: string; recipient_id: string; period_start: string; period_end: string; gross_amount: number; deductions: number; net_amount: number; status: string; approved_by: string | null; paid_at: string | null; payment_method: string; payment_reference: string; notes: string; created_at: string }
interface PayoutLineItem { id: string; payout_id: string; payment_id: string; description: string; gross_amount: number; calculated_amount: number; rate_snapshot: any }
interface Expense { id: string; org_id: string; category: string; description: string; amount: number; expense_date: string; paid_by: string; paid_for: string; cohort_id: string | null; is_reimbursable: boolean; reimbursed: boolean; offset_payout_id: string | null; notes: string; created_at: string }
interface Payment { id: string; amount_cents: number; status: string; cohort_id: string; participant_id: string; paid_at: string; affiliate_referral_id: string | null; commission_processed: boolean }
interface Enrollment { id: string; cohort_id: string; user_id: string; status: string }
interface Cohort { id: string; name: string; status: string; start_date: string }
interface Profile { id: string; full_name: string; email: string }
interface TaxRecord { recipient_type: string; recipient_id: string; recipient_name: string; recipient_email: string; tax_id: string; w9_on_file: boolean; tax_year: number; total_paid: number; payout_count: number; requires_1099: boolean }

const $$ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
const fD = (d: string) => d ? new Date(d + (d.includes('T') ? '' : 'T12:00:00')).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
const TABS = ['overview','payments','affiliates','payouts','expenses','tax','splits','commission-log'] as const
type Tab = typeof TABS[number]
const TAB_ICONS: Record<Tab, any> = { overview: LayoutDashboard, payments: DollarSign, affiliates: Users, payouts: Wallet, expenses: Receipt, tax: FileText, splits: Calculator, 'commission-log': BarChart3 }
const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', payments: 'Payments', affiliates: 'Affiliates', payouts: 'Payouts', expenses: 'Expenses', tax: '1099 / Tax', splits: 'Revenue Splits', 'commission-log': 'Commission Log' }
const STATUS_COLORS: Record<string, string> = { active: 'bg-emerald-100 text-emerald-700', paused: 'bg-amber-100 text-amber-700', terminated: 'bg-red-100 text-red-700', draft: 'bg-gray-100 text-gray-600', pending: 'bg-blue-100 text-blue-700', approved: 'bg-indigo-100 text-indigo-700', processing: 'bg-amber-100 text-amber-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-red-100 text-red-700', succeeded: 'bg-emerald-100 text-emerald-700', clicked: 'bg-gray-100 text-gray-600', signed_up: 'bg-blue-100 text-blue-700', enrolled: 'bg-indigo-100 text-indigo-700', paid: 'bg-emerald-100 text-emerald-700', refunded: 'bg-red-100 text-red-700' }
const EXPENSE_CATS = ['equipment','marketing','software','travel','supplies','personal_offset','reimbursement','cross_entity','other']

export default function NPFinancialPage() {
  const { currentOrg } = useWorkspace()
  const supabase = createClient()

  const [tab, setTab] = useState<Tab>('overview')
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Data
  const [rates, setRates] = useState<RateConfig[]>([])
  const [affiliates, setAffiliates] = useState<AffiliatePartner[]>([])
  const [referrals, setReferrals] = useState<AffiliateReferral[]>([])
  const [commissions, setCommissions] = useState<CommissionEntry[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [lineItems, setLineItems] = useState<PayoutLineItem[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [enrollments, setEnrollments] = useState<Enrollment[]>([])
  const [cohorts, setCohorts] = useState<Cohort[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [taxRecords, setTaxRecords] = useState<TaxRecord[]>([])

  // Forms
  const [showForm, setShowForm] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState<any>({})
  const [expandedPayout, setExpandedPayout] = useState<string | null>(null)

  const orgId = currentOrg?.id

  // ═══ Data Loading ═══════════════════════════════════════════
  const loadAll = useCallback(async () => {
    if (!orgId) return
    setLoading(true)
    try {
      const [rRes, aRes, refRes, cRes, pRes, plRes, eRes, pmRes, enRes, coRes, prRes, tRes] = await Promise.all([
        supabase.from('rate_configs').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('affiliate_partners').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('affiliate_referrals').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('commission_ledger').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('payouts').select('*').eq('org_id', orgId).order('created_at', { ascending: false }),
        supabase.from('payout_line_items').select('*'),
        supabase.from('expenses').select('*').eq('org_id', orgId).order('expense_date', { ascending: false }),
        supabase.from('payments').select('*').eq('status', 'completed').order('paid_at', { ascending: false }),
        supabase.from('enrollments').select('*'),
        supabase.from('cohorts').select('*').order('start_date', { ascending: false }),
        supabase.from('profiles').select('id, full_name, email'),
        supabase.rpc('get_1099_report', { p_org_id: orgId }).catch(() => ({ data: [] }))
      ])

      setRates(rRes.data || [])
      setAffiliates(aRes.data || [])
      setReferrals(refRes.data || [])
      setCommissions(cRes.data || [])
      setPayouts(pRes.data || [])
      setLineItems(plRes.data || [])
      setExpenses(eRes.data || [])
      setPayments(pmRes.data || [])
      setEnrollments(enRes.data || [])
      setCohorts(coRes.data || [])
      setProfiles(prRes.data || [])
      setTaxRecords(tRes.data || [])
    } catch (err) { console.error('Load error:', err) }
    setLoading(false)
  }, [orgId])

  useEffect(() => { loadAll() }, [loadAll])

  // ═══ Computed Values ════════════════════════════════════════
  const totalRevenue = useMemo(() => payments.reduce((s, p) => s + ((p.amount_cents || 0) / 100), 0), [payments])
  const totalExpenses = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses])
  const pendingReimbursements = useMemo(() => expenses.filter(e => e.is_reimbursable && !e.reimbursed).reduce((s, e) => s + e.amount, 0), [expenses])
  const unpaidCommissions = useMemo(() => commissions.filter(c => !c.payout_id && c.amount > 0).reduce((s, c) => s + c.amount, 0), [commissions])
  const draftPayouts = useMemo(() => payouts.filter(p => p.status === 'draft'), [payouts])
  const completedPayouts = useMemo(() => payouts.filter(p => p.status === 'completed').reduce((s, p) => s + p.net_amount, 0), [payouts])
  const getName = useCallback((id: string) => profiles.find(p => p.id === id)?.full_name || affiliates.find(a => a.id === id)?.name || 'Unknown', [profiles, affiliates])
  const getCohort = useCallback((id: string) => cohorts.find(c => c.id === id)?.name || '', [cohorts])

  // ═══ CRUD Operations ════════════════════════════════════════
  const saveAffiliate = async () => {
    const d = { ...formData, org_id: orgId }
    if (!d.referral_code) d.referral_code = d.name?.toLowerCase().replace(/\s+/g, '-') + '-' + Math.random().toString(36).slice(2, 6)
    if (editingId) {
      await supabase.from('affiliate_partners').update(d).eq('id', editingId)
    } else {
      await supabase.from('affiliate_partners').insert(d)
    }
    setShowForm(null); setEditingId(null); setFormData({}); loadAll()
  }

  const saveExpense = async () => {
    const d = { ...formData, org_id: orgId }
    if (editingId) {
      await supabase.from('expenses').update(d).eq('id', editingId)
    } else {
      await supabase.from('expenses').insert(d)
    }
    setShowForm(null); setEditingId(null); setFormData({}); loadAll()
  }

  const saveRate = async () => {
    const d = { ...formData, org_id: orgId }
    if (editingId) {
      await supabase.from('rate_configs').update(d).eq('id', editingId)
    } else {
      await supabase.from('rate_configs').insert(d)
    }
    setShowForm(null); setEditingId(null); setFormData({}); loadAll()
  }

  const deleteRecord = async (table: string, id: string) => {
    if (!confirm('Delete this record?')) return
    await supabase.from(table).delete().eq('id', id)
    loadAll()
  }

  const updatePayoutStatus = async (id: string, status: string) => {
    const updates: any = { status, updated_at: new Date().toISOString() }
    if (status === 'approved') { updates.approved_at = new Date().toISOString() }
    if (status === 'completed') { updates.paid_at = new Date().toISOString() }
    await supabase.from('payouts').update(updates).eq('id', id)
    loadAll()
  }

  const generatePayoutBatch = async () => {
    try {
      const res = await fetch('/api/financial/np/payout-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organization_id: orgId })
      })
      const result = await res.json()
      if (result.error) alert('Error: ' + result.error)
      else alert(`Created ${result.payouts_created} draft payouts`)
      loadAll()
    } catch (err) { console.error('Batch error:', err) }
  }

  // ═══ Render helpers ═════════════════════════════════════════
  const Badge = ({ status }: { status: string }) => (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )

  const StatCard = ({ icon: Icon, label, value, sub, color = 'blue' }: any) => (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className={`w-9 h-9 rounded-lg bg-${color}-50 flex items-center justify-center`}>
          <Icon className={`w-4 h-4 text-${color}-600`} />
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )

  const FormField = ({ label, children }: any) => (
    <div><label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>{children}</div>
  )

  const inputCls = 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none'
  const btnPrimary = 'px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors'
  const btnSecondary = 'px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors'

  if (!orgId) return <div className="p-8 text-gray-500">Select an organization to view NP Financials.</div>

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-blue-600" /> NP Financial Management
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Neuro Progeny Mastermind — Revenue, Payouts, Affiliates, Expenses, Tax</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadAll} className={btnSecondary}><RefreshCw className="w-3.5 h-3.5" /></button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4 overflow-x-auto">
          {TABS.map(t => {
            const Icon = TAB_ICONS[t]
            return (
              <button key={t} onClick={() => setTab(t)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg whitespace-nowrap transition-colors ${tab === t ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}>
                <Icon className="w-3.5 h-3.5" />{TAB_LABELS[t]}
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-6 max-w-7xl mx-auto">
        {loading ? (
          <div className="text-center py-20 text-gray-400">Loading financial data...</div>
        ) : (
          <>
            {/* ═══ OVERVIEW ═══ */}
            {tab === 'overview' && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard icon={DollarSign} label="Total Revenue" value={$$(totalRevenue)} sub={`${payments.length} payments`} color="emerald" />
                  <StatCard icon={Wallet} label="Total Paid Out" value={$$(completedPayouts)} sub={`${payouts.filter(p => p.status === 'completed').length} payouts`} color="blue" />
                  <StatCard icon={Receipt} label="Total Expenses" value={$$(totalExpenses)} sub={`${pendingReimbursements > 0 ? $$(pendingReimbursements) + ' pending reimbursement' : 'All reimbursed'}`} color="amber" />
                  <StatCard icon={Users} label="Active Affiliates" value={affiliates.filter(a => a.status === 'active').length} sub={`${$$(unpaidCommissions)} unpaid commissions`} color="purple" />
                </div>

                {/* Action Items */}
                {(draftPayouts.length > 0 || pendingReimbursements > 0 || affiliates.some(a => !a.w9_on_file && a.total_earned >= 600)) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5">
                    <h3 className="font-semibold text-amber-800 flex items-center gap-2 mb-3"><AlertTriangle className="w-4 h-4" /> Action Items</h3>
                    <div className="space-y-2">
                      {draftPayouts.length > 0 && (
                        <div className="flex items-center gap-2 text-sm text-amber-700">
                          <Clock className="w-3.5 h-3.5" /> {draftPayouts.length} draft payout(s) awaiting approval — {$$(draftPayouts.reduce((s, p) => s + p.net_amount, 0))}
                        </div>
                      )}
                      {pendingReimbursements > 0 && (
                        <div className="flex items-center gap-2 text-sm text-amber-700">
                          <Receipt className="w-3.5 h-3.5" /> {$$(pendingReimbursements)} in pending reimbursements
                        </div>
                      )}
                      {affiliates.filter(a => !a.w9_on_file && a.total_earned >= 600).map(a => (
                        <div key={a.id} className="flex items-center gap-2 text-sm text-red-700">
                          <AlertTriangle className="w-3.5 h-3.5" /> Missing W9: {a.name} (earned {$$(a.total_earned)})
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Revenue by Cohort */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">Revenue by Cohort</h3>
                  <div className="space-y-3">
                    {cohorts.map(c => {
                      const cohortPayments = payments.filter(p => p.cohort_id === c.id)
                      const rev = cohortPayments.reduce((s, p) => s + (p.amount_cents / 100), 0)
                      if (rev === 0) return null
                      return (
                        <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                          <div>
                            <span className="font-medium text-gray-900">{c.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{cohortPayments.length} payments</span>
                          </div>
                          <span className="font-semibold text-gray-900">{$$(rev)}</span>
                        </div>
                      )
                    }).filter(Boolean)}
                  </div>
                </div>
              </div>
            )}

            {/* ═══ PAYMENTS ═══ */}
            {tab === 'payments' && (
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">NP Payments ({payments.length})</h3>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="pl-9 pr-3 py-1.5 border border-gray-200 rounded-lg text-sm" />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                      <th className="px-5 py-3">Date</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Cohort</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Affiliate</th><th className="px-5 py-3">Commission</th>
                    </tr></thead>
                    <tbody>
                      {payments.filter(p => !search || JSON.stringify(p).toLowerCase().includes(search.toLowerCase())).slice(0, 50).map(p => {
                        const ref = p.affiliate_referral_id ? referrals.find(r => r.id === p.affiliate_referral_id) : null
                        const aff = ref ? affiliates.find(a => a.id === ref.affiliate_id) : null
                        return (
                          <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-5 py-3 text-gray-600">{fD(p.paid_at || '')}</td>
                            <td className="px-5 py-3 font-medium text-gray-900">{$$(p.amount_cents / 100)}</td>
                            <td className="px-5 py-3 text-gray-600">{p.cohort_id ? getCohort(p.cohort_id) : '—'}</td>
                            <td className="px-5 py-3"><Badge status={p.status} /></td>
                            <td className="px-5 py-3">{aff ? <span className="text-purple-600 font-medium">{aff.name}</span> : <span className="text-gray-300">—</span>}</td>
                            <td className="px-5 py-3">{p.commission_processed ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <span className="text-gray-300">—</span>}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ AFFILIATES ═══ */}
            {tab === 'affiliates' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Affiliate Partners ({affiliates.length})</h3>
                  <button onClick={() => { setShowForm('affiliate'); setEditingId(null); setFormData({ commission_type: 'percentage', commission_value: 10, commission_duration: 'first', status: 'active', tier: 'standard' }) }} className={btnPrimary}>
                    <span className="flex items-center gap-1.5"><UserPlus className="w-3.5 h-3.5" /> Add Affiliate</span>
                  </button>
                </div>

                {/* Affiliate Form */}
                {showForm === 'affiliate' && (
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold">{editingId ? 'Edit' : 'New'} Affiliate Partner</h4>
                      <button onClick={() => setShowForm(null)}><X className="w-4 h-4 text-gray-400" /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <FormField label="Name"><input className={inputCls} value={formData.name || ''} onChange={e => setFormData({ ...formData, name: e.target.value })} /></FormField>
                      <FormField label="Email"><input className={inputCls} type="email" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} /></FormField>
                      <FormField label="Phone"><input className={inputCls} value={formData.phone || ''} onChange={e => setFormData({ ...formData, phone: e.target.value })} /></FormField>
                      <FormField label="Referral Code"><input className={inputCls} value={formData.referral_code || ''} onChange={e => setFormData({ ...formData, referral_code: e.target.value })} placeholder="Auto-generated if blank" /></FormField>
                      <FormField label="Commission Type">
                        <select className={inputCls} value={formData.commission_type || 'percentage'} onChange={e => setFormData({ ...formData, commission_type: e.target.value })}>
                          <option value="percentage">Percentage</option><option value="flat">Flat Amount</option>
                        </select>
                      </FormField>
                      <FormField label={formData.commission_type === 'percentage' ? 'Commission %' : 'Commission $'}>
                        <input className={inputCls} type="number" value={formData.commission_value || ''} onChange={e => setFormData({ ...formData, commission_value: +e.target.value })} />
                      </FormField>
                      <FormField label="Duration">
                        <select className={inputCls} value={formData.commission_duration || 'first'} onChange={e => setFormData({ ...formData, commission_duration: e.target.value })}>
                          <option value="first">First Payment Only</option><option value="lifetime">Lifetime</option><option value="duration">Fixed Duration</option>
                        </select>
                      </FormField>
                      <FormField label="Tier">
                        <select className={inputCls} value={formData.tier || 'standard'} onChange={e => setFormData({ ...formData, tier: e.target.value })}>
                          <option value="standard">Standard</option><option value="gold">Gold</option><option value="strategic">Strategic</option>
                        </select>
                      </FormField>
                      <FormField label="Status">
                        <select className={inputCls} value={formData.status || 'active'} onChange={e => setFormData({ ...formData, status: e.target.value })}>
                          <option value="active">Active</option><option value="paused">Paused</option><option value="terminated">Terminated</option>
                        </select>
                      </FormField>
                      <FormField label="Tax ID (SSN/EIN)"><input className={inputCls} value={formData.tax_id || ''} onChange={e => setFormData({ ...formData, tax_id: e.target.value })} /></FormField>
                      <FormField label="W9 on File">
                        <select className={inputCls} value={formData.w9_on_file ? 'true' : 'false'} onChange={e => setFormData({ ...formData, w9_on_file: e.target.value === 'true' })}>
                          <option value="false">No</option><option value="true">Yes</option>
                        </select>
                      </FormField>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button onClick={saveAffiliate} className={btnPrimary}>{editingId ? 'Update' : 'Create'} Affiliate</button>
                      <button onClick={() => setShowForm(null)} className={btnSecondary}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Affiliate List */}
                {affiliates.map(a => (
                  <div key={a.id} className="bg-white rounded-xl border border-gray-200 p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center font-bold text-purple-700 text-sm">
                          {a.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <span className="font-semibold text-gray-900">{a.name}</span>
                          <span className="text-xs text-gray-400 ml-2">{a.email}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            <Badge status={a.status} />
                            <span className="text-xs text-gray-400">{a.tier}</span>
                            <code className="text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">{a.referral_code}</code>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => { setShowForm('affiliate'); setEditingId(a.id); setFormData(a) }} className="p-1.5 hover:bg-gray-100 rounded"><Pencil className="w-3.5 h-3.5 text-gray-400" /></button>
                        <button onClick={() => deleteRecord('affiliate_partners', a.id)} className="p-1.5 hover:bg-red-50 rounded"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-4 text-sm">
                      <div><span className="text-xs text-gray-400 block">Commission</span><span className="font-medium">{a.commission_type === 'percentage' ? `${a.commission_value}%` : $$( a.commission_value)}</span><span className="text-xs text-gray-400 ml-1">({a.commission_duration})</span></div>
                      <div><span className="text-xs text-gray-400 block">Referrals</span><span className="font-medium">{a.total_referrals}</span></div>
                      <div><span className="text-xs text-gray-400 block">Earned</span><span className="font-medium text-emerald-600">{$$(a.total_earned)}</span></div>
                      <div><span className="text-xs text-gray-400 block">Paid</span><span className="font-medium">{$$(a.total_paid)}</span></div>
                      <div><span className="text-xs text-gray-400 block">W9</span>{a.w9_on_file ? <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5" /> : <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5" />}</div>
                    </div>
                    {/* Referral Link Builder */}
                    <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2">
                      <Link2 className="w-3.5 h-3.5 text-gray-400" />
                      <code className="text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded flex-1">
                        {typeof window !== 'undefined' ? window.location.origin : 'https://npu.neuroprogeny.com'}/enroll?ref={a.referral_code}
                      </code>
                      <button onClick={() => navigator.clipboard.writeText(`${window.location.origin}/enroll?ref=${a.referral_code}`)} className="text-xs text-blue-600 hover:underline">Copy</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ PAYOUTS ═══ */}
            {tab === 'payouts' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Payouts ({payouts.length})</h3>
                  <button onClick={generatePayoutBatch} className={btnPrimary}>
                    <span className="flex items-center gap-1.5"><Calculator className="w-3.5 h-3.5" /> Generate Payout Batch</span>
                  </button>
                </div>

                {payouts.length === 0 ? (
                  <div className="bg-white rounded-xl border border-gray-200 p-10 text-center text-gray-400">No payouts yet. Generate a batch to create draft payouts.</div>
                ) : payouts.map(p => (
                  <div key={p.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-5 py-4 flex items-center justify-between cursor-pointer hover:bg-gray-50" onClick={() => setExpandedPayout(expandedPayout === p.id ? null : p.id)}>
                      <div className="flex items-center gap-3">
                        <Badge status={p.status} />
                        <span className="font-medium text-gray-900">{getName(p.recipient_id)}</span>
                        <span className="text-xs px-2 py-0.5 bg-gray-100 rounded text-gray-500">{p.recipient_type}</span>
                        <span className="text-xs text-gray-400">{fD(p.period_start)} — {fD(p.period_end)}</span>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className="font-bold text-gray-900">{$$(p.net_amount)}</span>
                        {p.deductions > 0 && <span className="text-xs text-red-500">-{$$(p.deductions)} offsets</span>}
                        {expandedPayout === p.id ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
                      </div>
                    </div>
                    {expandedPayout === p.id && (
                      <div className="px-5 pb-4 border-t border-gray-100 pt-4">
                        <div className="grid grid-cols-4 gap-3 text-sm mb-4">
                          <div><span className="text-xs text-gray-400 block">Gross</span>{$$(p.gross_amount)}</div>
                          <div><span className="text-xs text-gray-400 block">Deductions</span>{$$(p.deductions)}</div>
                          <div><span className="text-xs text-gray-400 block">Net</span><span className="font-bold">{$$(p.net_amount)}</span></div>
                          <div><span className="text-xs text-gray-400 block">Paid</span>{p.paid_at ? fD(p.paid_at) : '—'}</div>
                        </div>
                        {/* Line items */}
                        {lineItems.filter(li => li.payout_id === p.id).length > 0 && (
                          <div className="mb-4">
                            <span className="text-xs font-medium text-gray-500 uppercase">Line Items</span>
                            {lineItems.filter(li => li.payout_id === p.id).map(li => (
                              <div key={li.id} className="flex justify-between text-xs py-1 border-b border-gray-50">
                                <span className="text-gray-600">{li.description || 'Payment'}</span>
                                <span className="text-gray-900">{$$(li.calculated_amount)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Actions */}
                        <div className="flex gap-2">
                          {p.status === 'draft' && <button onClick={() => updatePayoutStatus(p.id, 'approved')} className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">Approve</button>}
                          {p.status === 'approved' && <button onClick={() => updatePayoutStatus(p.id, 'completed')} className="px-3 py-1.5 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700">Mark Paid</button>}
                          {['draft','pending'].includes(p.status) && <button onClick={() => updatePayoutStatus(p.id, 'cancelled')} className="px-3 py-1.5 bg-red-50 text-red-600 text-xs rounded-lg hover:bg-red-100">Cancel</button>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ═══ EXPENSES ═══ */}
            {tab === 'expenses' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Expenses ({expenses.length}) — {$$(totalExpenses)}</h3>
                  <button onClick={() => { setShowForm('expense'); setEditingId(null); setFormData({ category: 'equipment', expense_date: new Date().toISOString().split('T')[0], is_reimbursable: false }) }} className={btnPrimary}>
                    <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Expense</span>
                  </button>
                </div>

                {showForm === 'expense' && (
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold">{editingId ? 'Edit' : 'New'} Expense</h4>
                      <button onClick={() => setShowForm(null)}><X className="w-4 h-4 text-gray-400" /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <FormField label="Category">
                        <select className={inputCls} value={formData.category || 'equipment'} onChange={e => setFormData({ ...formData, category: e.target.value })}>
                          {EXPENSE_CATS.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                        </select>
                      </FormField>
                      <FormField label="Amount"><input className={inputCls} type="number" step="0.01" value={formData.amount || ''} onChange={e => setFormData({ ...formData, amount: +e.target.value })} /></FormField>
                      <FormField label="Date"><input className={inputCls} type="date" value={formData.expense_date || ''} onChange={e => setFormData({ ...formData, expense_date: e.target.value })} /></FormField>
                      <FormField label="Description"><input className={inputCls} value={formData.description || ''} onChange={e => setFormData({ ...formData, description: e.target.value })} /></FormField>
                      <FormField label="Paid For (profile ID or 'org')"><input className={inputCls} value={formData.paid_for || ''} onChange={e => setFormData({ ...formData, paid_for: e.target.value })} placeholder="org" /></FormField>
                      <FormField label="Reimbursable?">
                        <select className={inputCls} value={formData.is_reimbursable ? 'true' : 'false'} onChange={e => setFormData({ ...formData, is_reimbursable: e.target.value === 'true' })}>
                          <option value="false">No</option><option value="true">Yes — offset from payout</option>
                        </select>
                      </FormField>
                      <div className="col-span-3"><FormField label="Notes"><input className={inputCls} value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></FormField></div>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button onClick={saveExpense} className={btnPrimary}>{editingId ? 'Update' : 'Add'} Expense</button>
                      <button onClick={() => setShowForm(null)} className={btnSecondary}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Category Breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 p-5">
                  <h4 className="font-medium text-gray-700 text-sm mb-3">By Category</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {EXPENSE_CATS.map(cat => {
                      const catTotal = expenses.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0)
                      if (catTotal === 0) return null
                      return (
                        <div key={cat} className="flex justify-between py-2 border-b border-gray-50">
                          <span className="text-sm text-gray-600 capitalize">{cat.replace(/_/g, ' ')}</span>
                          <span className="text-sm font-medium text-gray-900">{$$(catTotal)}</span>
                        </div>
                      )
                    }).filter(Boolean)}
                  </div>
                </div>

                {/* Expense List */}
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                      <th className="px-5 py-3">Date</th><th className="px-5 py-3">Category</th><th className="px-5 py-3">Description</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Reimb.</th><th className="px-5 py-3"></th>
                    </tr></thead>
                    <tbody>
                      {expenses.map(e => (
                        <tr key={e.id} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="px-5 py-3 text-gray-600">{fD(e.expense_date)}</td>
                          <td className="px-5 py-3 capitalize text-gray-600">{e.category.replace(/_/g, ' ')}</td>
                          <td className="px-5 py-3 text-gray-900">{e.description}</td>
                          <td className="px-5 py-3 font-medium text-gray-900">{$$(e.amount)}</td>
                          <td className="px-5 py-3">{e.is_reimbursable ? (e.reimbursed ? <Badge status="completed" /> : <Badge status="pending" />) : '—'}</td>
                          <td className="px-5 py-3">
                            <button onClick={() => { setShowForm('expense'); setEditingId(e.id); setFormData(e) }} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-3 h-3 text-gray-400" /></button>
                            <button onClick={() => deleteRecord('expenses', e.id)} className="p-1 hover:bg-red-50 rounded ml-1"><Trash2 className="w-3 h-3 text-red-400" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ TAX / 1099 ═══ */}
            {tab === 'tax' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">1099 Contractor Tracker — {new Date().getFullYear()}</h3>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                      <th className="px-5 py-3">Recipient</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">YTD Paid</th><th className="px-5 py-3"># Payouts</th><th className="px-5 py-3">W9</th><th className="px-5 py-3">1099 Required</th>
                    </tr></thead>
                    <tbody>
                      {/* Build from completed payouts */}
                      {(() => {
                        const byRecipient: Record<string, { type: string; name: string; total: number; count: number; w9: boolean }> = {}
                        payouts.filter(p => p.status === 'completed').forEach(p => {
                          const key = p.recipient_id
                          if (!byRecipient[key]) {
                            const aff = affiliates.find(a => a.id === p.recipient_id)
                            byRecipient[key] = { type: p.recipient_type, name: getName(p.recipient_id), total: 0, count: 0, w9: aff?.w9_on_file || false }
                          }
                          byRecipient[key].total += p.net_amount
                          byRecipient[key].count++
                        })
                        return Object.entries(byRecipient).map(([id, r]) => (
                          <tr key={id} className="border-b border-gray-50">
                            <td className="px-5 py-3 font-medium text-gray-900">{r.name}</td>
                            <td className="px-5 py-3"><span className="text-xs px-2 py-0.5 bg-gray-100 rounded">{r.type}</span></td>
                            <td className="px-5 py-3 font-medium">{$$(r.total)}</td>
                            <td className="px-5 py-3 text-gray-600">{r.count}</td>
                            <td className="px-5 py-3">{r.w9 ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <AlertTriangle className="w-4 h-4 text-amber-500" />}</td>
                            <td className="px-5 py-3">{r.total >= 600 ? <span className="text-red-600 font-medium flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Yes</span> : <span className="text-gray-400">No (under $600)</span>}</td>
                          </tr>
                        ))
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ═══ REVENUE SPLITS ═══ */}
            {tab === 'splits' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">Rate Configurations ({rates.length})</h3>
                  <button onClick={() => { setShowForm('rate'); setEditingId(null); setFormData({ target_type: 'admin', rate_type: 'percentage', rate_value: 0, applies_to: 'all', effective_from: new Date().toISOString().split('T')[0] }) }} className={btnPrimary}>
                    <span className="flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Add Rate</span>
                  </button>
                </div>

                {showForm === 'rate' && (
                  <div className="bg-white rounded-xl border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="font-semibold">{editingId ? 'Edit' : 'New'} Rate Config</h4>
                      <button onClick={() => setShowForm(null)}><X className="w-4 h-4 text-gray-400" /></button>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                      <FormField label="Target Type">
                        <select className={inputCls} value={formData.target_type || 'admin'} onChange={e => setFormData({ ...formData, target_type: e.target.value })}>
                          <option value="platform">Platform</option><option value="admin">Admin</option><option value="facilitator">Facilitator</option><option value="affiliate">Affiliate</option>
                        </select>
                      </FormField>
                      <FormField label="Target (profile)">
                        <select className={inputCls} value={formData.target_id || ''} onChange={e => setFormData({ ...formData, target_id: e.target.value || null })}>
                          <option value="">Org-wide default</option>
                          {profiles.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
                        </select>
                      </FormField>
                      <FormField label="Rate Type">
                        <select className={inputCls} value={formData.rate_type || 'percentage'} onChange={e => setFormData({ ...formData, rate_type: e.target.value })}>
                          <option value="percentage">Percentage</option><option value="flat_per_participant">Flat per Participant</option><option value="flat_total">Flat Total</option>
                        </select>
                      </FormField>
                      <FormField label="Rate Value"><input className={inputCls} type="number" step="0.01" value={formData.rate_value || ''} onChange={e => setFormData({ ...formData, rate_value: +e.target.value })} /></FormField>
                      <FormField label="Applies To">
                        <select className={inputCls} value={formData.applies_to || 'all'} onChange={e => setFormData({ ...formData, applies_to: e.target.value })}>
                          <option value="all">All</option><option value="program">Program Only</option><option value="map">Map Only</option><option value="vr_only">VR Only</option>
                        </select>
                      </FormField>
                      <FormField label="Effective From"><input className={inputCls} type="date" value={formData.effective_from || ''} onChange={e => setFormData({ ...formData, effective_from: e.target.value })} /></FormField>
                      <FormField label="Cohort (optional)">
                        <select className={inputCls} value={formData.cohort_id || ''} onChange={e => setFormData({ ...formData, cohort_id: e.target.value || null })}>
                          <option value="">All cohorts</option>
                          {cohorts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      </FormField>
                      <FormField label="Notes"><input className={inputCls} value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} /></FormField>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <button onClick={saveRate} className={btnPrimary}>{editingId ? 'Update' : 'Create'} Rate</button>
                      <button onClick={() => setShowForm(null)} className={btnSecondary}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Group by target type */}
                {['platform','admin','facilitator','affiliate'].map(type => {
                  const typeRates = rates.filter(r => r.target_type === type)
                  if (typeRates.length === 0) return null
                  return (
                    <div key={type} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                        <span className="font-semibold text-sm capitalize text-gray-700">{type} Rates ({typeRates.length})</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead><tr className="text-left text-xs text-gray-500 uppercase">
                          <th className="px-5 py-2">Target</th><th className="px-5 py-2">Rate</th><th className="px-5 py-2">Applies To</th><th className="px-5 py-2">Cohort</th><th className="px-5 py-2">Effective</th><th className="px-5 py-2"></th>
                        </tr></thead>
                        <tbody>
                          {typeRates.map(r => (
                            <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="px-5 py-3 text-gray-900">{r.target_id ? getName(r.target_id) : <span className="italic text-gray-400">Org default</span>}</td>
                              <td className="px-5 py-3 font-medium">{r.rate_type === 'percentage' ? `${r.rate_value}%` : $$( r.rate_value)} <span className="text-xs text-gray-400">{r.rate_type.replace(/_/g, ' ')}</span></td>
                              <td className="px-5 py-3 text-gray-600">{r.applies_to}</td>
                              <td className="px-5 py-3 text-gray-600">{r.cohort_id ? getCohort(r.cohort_id) : 'All'}</td>
                              <td className="px-5 py-3 text-gray-600">{fD(r.effective_from)}{r.effective_until ? ` — ${fD(r.effective_until)}` : ''}</td>
                              <td className="px-5 py-3 flex gap-1">
                                <button onClick={() => { setShowForm('rate'); setEditingId(r.id); setFormData(r) }} className="p-1 hover:bg-gray-100 rounded"><Pencil className="w-3 h-3 text-gray-400" /></button>
                                <button onClick={() => deleteRecord('rate_configs', r.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ═══ COMMISSION LOG ═══ */}
            {tab === 'commission-log' && (
              <div className="space-y-4">
                <h3 className="font-semibold text-gray-900">Commission Ledger ({commissions.length} entries)</h3>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase">
                      <th className="px-5 py-3">Date</th><th className="px-5 py-3">Affiliate</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Amount</th><th className="px-5 py-3">Note</th><th className="px-5 py-3">Paid Out</th>
                    </tr></thead>
                    <tbody>
                      {commissions.map(c => {
                        const aff = affiliates.find(a => a.id === c.affiliate_id)
                        return (
                          <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                            <td className="px-5 py-3 text-gray-600">{fD(c.created_at)}</td>
                            <td className="px-5 py-3 text-gray-900 font-medium">{aff?.name || 'Unknown'}</td>
                            <td className="px-5 py-3"><Badge status={c.entry_type} /></td>
                            <td className={`px-5 py-3 font-medium ${c.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{c.amount < 0 ? '-' : '+'}{$$(Math.abs(c.amount))}</td>
                            <td className="px-5 py-3 text-gray-500 text-xs">{c.note || '—'}</td>
                            <td className="px-5 py-3">{c.payout_id ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <Clock className="w-4 h-4 text-gray-300" />}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
