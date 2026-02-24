'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronDown, ChevronRight, ExternalLink, Building2, Tag, Eye, Loader2 } from 'lucide-react'
import type { CrmContact } from '@/types/crm'

interface CrossOrgContact extends CrmContact {
  _cross_org: true
  _source_org_id: string
  _source_org_name: string
  _matched_tags: string[]
}

const STAGE_COLORS: Record<string, string> = {
  'New Lead': '#8B5CF6', 'Contacted': '#3B82F6', 'Qualified': '#10B981',
  'Proposal': '#F59E0B', 'Enrolled': '#386797', 'Active': '#059669',
  'Won': '#16A34A', 'Lost': '#6B7280',
}

export default function CrossOrgContactsPanel({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [contacts, setContacts] = useState<CrossOrgContact[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState(true)
  const [hasRules, setHasRules] = useState(false)

  const load = useCallback(async () => {
    if (!orgId) return; setLoading(true)
    try {
      const res = await fetch('/api/crm/cross-org-contacts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: orgId }),
      })
      if (!res.ok) { setLoading(false); return }
      const data = await res.json()
      setContacts(data.contacts || [])
      setHasRules((data.rules || []).some((r: any) => r.enabled && r.tags?.length > 0))
    } catch (e) { console.error('Cross-org error:', e) }
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  // Don't render if no sharing rules configured
  if (!loading && !hasRules) return null

  // Group contacts by source org
  const byOrg = contacts.reduce<Record<string, { name: string; contacts: CrossOrgContact[] }>>((acc, c) => {
    if (!acc[c._source_org_id]) acc[c._source_org_id] = { name: c._source_org_name, contacts: [] }
    acc[c._source_org_id].contacts.push(c)
    return acc
  }, {})

  return (
    <div className="mt-4 bg-white rounded-2xl border border-purple-100 overflow-hidden">
      {/* Header */}
      <button onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-5 py-3.5 hover:bg-purple-50/30 transition-colors text-left">
        <Building2 size={13} className="text-purple-500 shrink-0" />
        <span className="text-[11px] font-bold text-np-dark">Cross-Org Contacts</span>
        {loading ? (
          <Loader2 size={11} className="animate-spin text-purple-400" />
        ) : (
          <span className="text-[10px] font-semibold text-purple-400 bg-purple-50 px-2 py-0.5 rounded-md">{contacts.length}</span>
        )}
        <span className="text-[9px] text-gray-400 flex-1">Shared via tag matching</span>
        {expanded ? <ChevronDown size={12} className="text-gray-300" /> : <ChevronRight size={12} className="text-gray-300" />}
      </button>

      {/* Expanded content */}
      {expanded && !loading && (
        <div className="border-t border-purple-50">
          {contacts.length === 0 && hasRules && (
            <div className="px-5 py-6 text-center">
              <p className="text-[11px] text-gray-400">No contacts match the configured sharing tags yet.</p>
              <p className="text-[10px] text-gray-300 mt-1">Tag contacts in the source org to see them here.</p>
            </div>
          )}

          {Object.entries(byOrg).map(([orgId, group]) => (
            <div key={orgId}>
              {/* Source org sub-header */}
              <div className="px-5 py-2 bg-purple-50/40 border-b border-purple-50 flex items-center gap-2">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-[8px] font-bold rounded-md uppercase">{group.name.split(' ')[0]}</span>
                <span className="text-[10px] text-purple-600 font-medium">{group.contacts.length} contact{group.contacts.length !== 1 ? 's' : ''} from {group.name}</span>
                <Eye size={10} className="text-purple-300 ml-auto" />
                <span className="text-[9px] text-purple-300">Read-only</span>
              </div>

              {/* Contact rows */}
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[8px] font-bold text-gray-400 uppercase tracking-wider bg-gray-50/50">
                    <th className="px-5 py-2">Name</th>
                    <th className="px-3 py-2">Email</th>
                    <th className="px-3 py-2">Phone</th>
                    <th className="px-3 py-2">Company</th>
                    <th className="px-3 py-2">Stage</th>
                    <th className="px-3 py-2">Matched Tags</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {group.contacts.map(c => {
                    const name = `${c.first_name || ''} ${c.last_name || ''}`.trim() || 'Unknown'
                    const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase() || '??'
                    const stageColor = STAGE_COLORS[c.pipeline_stage || ''] || '#9CA3AF'
                    return (
                      <tr key={c.id} className="border-t border-gray-50 hover:bg-purple-50/20 transition-colors group">
                        <td className="px-5 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-[9px] font-bold shrink-0">{initials}</div>
                            <div>
                              <div className="text-[11px] font-semibold text-np-dark">{name}</div>
                              {c.preferred_name && <div className="text-[9px] text-gray-400">"{c.preferred_name}"</div>}
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[10px] text-gray-600">{c.email || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] text-gray-600">{c.phone || '—'}</td>
                        <td className="px-3 py-2.5 text-[10px] text-gray-600">{c.company || '—'}</td>
                        <td className="px-3 py-2.5">
                          {c.pipeline_stage ? (
                            <span className="px-2 py-0.5 rounded-full text-[9px] font-semibold" style={{ background: stageColor + '15', color: stageColor }}>{c.pipeline_stage}</span>
                          ) : <span className="text-[10px] text-gray-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {c._matched_tags.map(t => (
                              <span key={t} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-teal-50 text-teal-700 text-[8px] font-semibold rounded border border-teal-200">
                                <Tag size={7} />{t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 text-[8px] font-bold rounded">{c._source_org_name.split(' ')[0]}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
