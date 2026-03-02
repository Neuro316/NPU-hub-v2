'use client'

import { useEffect, useState, useMemo } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  HeartPulse, Activity, Brain, FileText, Users, ExternalLink,
  Search, Filter, ChevronDown, Eye, Clock,
  CheckCircle2, AlertCircle, BarChart3, Zap, Shield
} from 'lucide-react'

/* ═══════════════════════════════════════════════════════════════
   ECR — Electronic Client Records
   
   Hub-side view of enrolled, paid clients and their clinical data.
   ECR activates ONLY after payment + enrollment (no clinical record
   exists without a paid relationship).
   
   Reads from shared Supabase tables:
   - contacts (CRM) ← Hub
   - profiles (identity) ← University
   - payments (paid status) ← University Stripe webhook
   - Assessments + sessions come from NeuroReport API (future)
   ═══════════════════════════════════════════════════════════════ */

interface EcrRecord {
  id: string
  name: string
  email: string
  program: string
  status: 'active' | 'completed' | 'paused'
  enrolledAt: string
  sessionsCount: number
  lastSessionDate: string | null
  assessments: string[]
  hrv: { rmssd: number | null; sdnn: number | null; lf_hf: number | null }
  contactId: string | null
  hasNeuroReport: boolean
}

export default function EcrPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [records, setRecords] = useState<EcrRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedRecord, setSelectedRecord] = useState<string | null>(null)

  useEffect(() => {
    if (!currentOrg) return
    loadEcrRecords()
  }, [currentOrg])

  async function loadEcrRecords() {
    setLoading(true)
    const supabase = createClient()

    try {
      // Enrolled contacts with paid relationship
      const { data: enrolledContacts } = await supabase
        .from('contacts')
        .select('id, first_name, last_name, email, tags, pipeline_stage, created_at')
        .eq('org_id', currentOrg!.id)
        .eq('pipeline_stage', 'Enrolled')
        .order('created_at', { ascending: false })

      if (!enrolledContacts || enrolledContacts.length === 0) {
        setRecords([])
        setLoading(false)
        return
      }

      const { data: payments } = await supabase
        .from('payments')
        .select('id, participant_id, amount_cents, status, cohort_id, paid_at')
        .eq('status', 'completed')

      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email, role')
        .eq('role', 'participant')

      const ecrRecords: EcrRecord[] = (enrolledContacts || []).map(contact => {
        const fullName = `${contact.first_name || ''} ${contact.last_name || ''}`.trim()
        const tags = contact.tags || []
        const profileMatch = (profiles || []).find(p => p.email?.toLowerCase() === contact.email?.toLowerCase())
        const contactPayments = profileMatch
          ? (payments || []).filter(p => p.participant_id === profileMatch.id)
          : []
        const hasPaid = contactPayments.length > 0

        let program = 'Unknown'
        if (tags.includes('Mastermind')) program = 'Immersive Mastermind'
        else if (tags.includes('HC')) program = 'Health Consumer'
        else if (tags.includes('Clinician/Coach')) program = 'Coach Platform'

        return {
          id: contact.id,
          name: fullName || contact.email,
          email: contact.email,
          program,
          status: hasPaid ? 'active' as const : 'paused' as const,
          enrolledAt: contact.created_at,
          sessionsCount: 0, // Populated from NeuroReport API later
          lastSessionDate: null,
          assessments: [],
          hrv: { rmssd: null, sdnn: null, lf_hf: null },
          contactId: contact.id,
          hasNeuroReport: !!profileMatch,
        }
      })

      setRecords(ecrRecords)
    } catch (err) {
      console.error('ECR load error:', err)
    }
    setLoading(false)
  }

  const filtered = useMemo(() => {
    let list = records
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(r => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q))
    }
    if (statusFilter !== 'all') list = list.filter(r => r.status === statusFilter)
    return list
  }, [records, search, statusFilter])

  const stats = useMemo(() => ({
    total: records.length,
    active: records.filter(r => r.status === 'active').length,
    linked: records.filter(r => r.hasNeuroReport).length,
    mastermind: records.filter(r => r.program === 'Immersive Mastermind').length,
  }), [records])

  const selected = records.find(r => r.id === selectedRecord)

  if (orgLoading || loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-gray-400">Loading client records...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Electronic Client Records</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · ECR activates after payment + enrollment</p>
        </div>
        <a
          href="https://neuroreport.app"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90 transition-colors"
        >
          <ExternalLink className="w-3.5 h-3.5" /> Open NeuroReport
        </a>
      </div>

      {/* Access Control Banner */}
      <div className="mb-6 bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <Shield className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-amber-900">ECR Access Control</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Client records only exist for contacts with a <strong>paid relationship</strong>. 
            CRM contacts must be in the <strong>Enrolled</strong> pipeline stage with a completed payment. 
            No client data is accessible without payment verification.
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'ECR Records', value: stats.total, icon: HeartPulse, color: 'text-rose-500', bg: 'bg-rose-50' },
          { label: 'Active Programs', value: stats.active, icon: Activity, color: 'text-emerald-500', bg: 'bg-emerald-50' },
          { label: 'NeuroReport Linked', value: stats.linked, icon: Brain, color: 'text-purple-500', bg: 'bg-purple-50' },
          { label: 'Mastermind Enrolled', value: stats.mastermind, icon: Zap, color: 'text-np-blue', bg: 'bg-np-blue/5' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-5">
            <div className={`w-10 h-10 rounded-lg ${s.bg} flex items-center justify-center mb-3`}>
              <s.icon className={`w-5 h-5 ${s.color}`} />
            </div>
            <div className="text-2xl font-bold text-np-dark">{s.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Three-System Ownership */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-gray-400" />
          Data Ownership
        </h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="border-l-2 border-np-blue pl-3">
            <div className="text-xs font-semibold text-np-blue mb-1">Hub (CRM + Finance)</div>
            <p className="text-xs text-gray-500">Contact identity, pipeline stage, tags, affiliate attribution, commissions, payouts.</p>
          </div>
          <div className="border-l-2 border-purple-500 pl-3">
            <div className="text-xs font-semibold text-purple-600 mb-1">University (Enrollment)</div>
            <p className="text-xs text-gray-500">Payments, enrollments, cohort assignment, paywalls, courses, session notes.</p>
          </div>
          <div className="border-l-2 border-orange-500 pl-3">
            <div className="text-xs font-semibold text-orange-600 mb-1">NeuroReport (Assessments)</div>
            <p className="text-xs text-gray-500">QEEG maps, FNA scoring, HRV baselines, VR biofeedback data, AI interpretation.</p>
          </div>
        </div>
      </div>

      {/* Tag Access Reference */}
      <div className="bg-white border border-gray-100 rounded-xl p-5 mb-6">
        <h3 className="text-sm font-semibold text-np-dark mb-3 flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          Tag-Based Access
        </h3>
        <div className="space-y-2">
          {[
            { tag: 'Mastermind', color: 'bg-teal-100 text-teal-700', access: 'Full curriculum + VR sessions + NeuroReport ECR (QEEG, FNA, HRV, AI)' },
            { tag: 'HC', color: 'bg-purple-100 text-purple-700', access: 'HRV dashboard only, no NeuroReport access' },
            { tag: 'Clinician/Coach', color: 'bg-orange-100 text-orange-700', access: 'Facilitator view + NeuroReport client management' },
          ].map(t => (
            <div key={t.tag} className="flex items-start gap-3">
              <span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${t.color} flex-shrink-0`}>{t.tag}</span>
              <p className="text-xs text-gray-500">{t.access}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email..."
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-np-blue/20 focus:border-np-blue"
          />
        </div>
        <div className="flex gap-1">
          {['all', 'active', 'completed', 'paused'].map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-lg text-xs font-medium transition-colors
                ${statusFilter === s ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Records Table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <HeartPulse className="w-14 h-14 text-gray-200 mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-np-dark mb-2">
              {records.length === 0 ? 'No Client Records Yet' : 'No Matching Records'}
            </h2>
            <p className="text-sm text-gray-500 max-w-md mx-auto">
              {records.length === 0
                ? 'ECR records appear when contacts reach Enrolled with a completed payment. Purchases flow through University paywalls.'
                : 'Try adjusting your search or filter criteria.'}
            </p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                {['Client', 'Program', 'Status', 'Sessions', 'Assessments', 'NeuroReport', 'Enrolled'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr
                  key={r.id}
                  onClick={() => setSelectedRecord(r.id === selectedRecord ? null : r.id)}
                  className={`border-b border-gray-50 cursor-pointer transition-colors
                    ${r.id === selectedRecord ? 'bg-np-blue/5' : 'hover:bg-gray-50'}`}
                >
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-np-dark">{r.name}</div>
                    <div className="text-xs text-gray-400">{r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-md text-xs font-semibold
                      ${r.program === 'Immersive Mastermind' ? 'bg-teal-100 text-teal-700' :
                        r.program === 'Health Consumer' ? 'bg-purple-100 text-purple-700' :
                        r.program === 'Coach Platform' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'}`}
                    >{r.program}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-semibold
                      ${r.status === 'active' ? 'bg-emerald-100 text-emerald-700' :
                        r.status === 'completed' ? 'bg-blue-100 text-blue-700' :
                        'bg-amber-100 text-amber-700'}`}
                    >
                      {r.status === 'active' ? <CheckCircle2 className="w-3 h-3" /> :
                       r.status === 'paused' ? <AlertCircle className="w-3 h-3" /> :
                       <CheckCircle2 className="w-3 h-3" />}
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-np-dark">{r.sessionsCount}</td>
                  <td className="px-4 py-3">
                    {r.assessments.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">
                        {r.assessments.map(a => (
                          <span key={a} className="px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded text-[10px] font-medium">{a}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-400">None yet</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.hasNeuroReport ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 text-orange-600 rounded-md text-xs font-semibold">
                        <Brain className="w-3 h-3" /> Linked
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">Not linked</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(r.enrolledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail Panel */}
      {selected && (
        <div className="mt-4 bg-white border border-gray-100 rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-np-dark">{selected.name}</h3>
            <div className="flex gap-2">
              <a href={`/crm/contacts?search=${encodeURIComponent(selected.email)}`}
                className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium hover:bg-gray-200 transition-colors">
                <Users className="w-3 h-3" /> View in CRM
              </a>
              <a href="https://neuroreport.app" target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-200 transition-colors">
                <Brain className="w-3 h-3" /> Open in NeuroReport
              </a>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div className="bg-teal-50 rounded-xl p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">RMSSD</div>
              <div className="text-2xl font-bold text-teal-600">{selected.hrv.rmssd ? `${selected.hrv.rmssd} ms` : '---'}</div>
            </div>
            <div className="bg-amber-50 rounded-xl p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">SDNN</div>
              <div className="text-2xl font-bold text-amber-600">{selected.hrv.sdnn ? `${selected.hrv.sdnn} ms` : '---'}</div>
            </div>
            <div className="bg-rose-50 rounded-xl p-4 text-center">
              <div className="text-xs text-gray-500 mb-1">LF/HF Ratio</div>
              <div className="text-2xl font-bold text-rose-600">{selected.hrv.lf_hf ? selected.hrv.lf_hf.toFixed(1) : '---'}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Assessment Data (via NeuroReport)</h4>
              <div className="space-y-1.5 text-xs text-gray-600">
                {['QEEG Brain Maps (pre/post)', 'FNA Scoring (cranial nerves, reflexes, balance)', 'NSCI Capacity Index', 'AI-Generated Interpretation Reports'].map(item => (
                  <div key={item} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-teal-500" />{item}</div>
                ))}
              </div>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Session Data (via xRegulation)</h4>
              <div className="space-y-1.5 text-xs text-gray-600">
                {['VR Biofeedback Sessions', 'HRV Metrics (RMSSD, SDNN, LF/HF)', 'Training Phase Progression', 'Session Notes (facilitator-entered)'].map(item => (
                  <div key={item} className="flex items-center gap-2"><CheckCircle2 className="w-3 h-3 text-purple-500" />{item}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
