'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Contacts — Rolodex with search, filters, table, bulk actions
// Route: /crm/contacts
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  Search, Plus, Filter, Download, Upload, MoreHorizontal,
  Star, Tag, ChevronDown, X, Check, Users
} from 'lucide-react'
import { fetchContacts, bulkUpdateContacts } from '@/lib/crm-client'
import type { CrmContact, ContactSearchParams, PipelineStage } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'
import ContactDetail from '@/components/crm/contact-detail'

const TAG_COLORS: Record<string, string> = {
  VIP: '#FBBF24', 'Hot Lead': '#F87171', Partner: '#34D399', Referral: '#2A9D8F',
  Practitioner: '#9CAF88', Investor: '#A78BFA', Speaker: '#E76F51', Collaborator: '#228DC4',
}

function ContactTag({ tag }: { tag: string }) {
  const color = TAG_COLORS[tag] || '#94a3b8'
  return (
    <span
      className="inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
      style={{ background: color + '18', color }}
    >
      {tag}
    </span>
  )
}

export default function ContactsPage() {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [stageFilter, setStageFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [sortBy, setSortBy] = useState<'updated_at' | 'last_name' | 'last_contacted_at'>('updated_at')
  const [page, setPage] = useState(0)
  const limit = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params: ContactSearchParams = { limit, offset: page * limit }
      if (search) params.q = search
      if (stageFilter) params.pipeline_stage = stageFilter
      if (tagFilter) params.tags = [tagFilter]
      const res = await fetchContacts(params)
      setContacts(res.contacts)
      setTotal(res.total)
    } catch (e) {
      console.error('Contact load error:', e)
    } finally {
      setLoading(false)
    }
  }, [search, stageFilter, tagFilter, page])

  useEffect(() => { load() }, [load])

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set())
    else setSelected(new Set(contacts.map(c => c.id)))
  }

  const handleBulkAction = async (action: string, params: Record<string, unknown>) => {
    if (selected.size === 0) return
    try {
      await bulkUpdateContacts(Array.from(selected), action, params)
      setSelected(new Set())
      load()
    } catch (e) {
      console.error('Bulk action error:', e)
    }
  }

  // Get all unique tags for filter dropdown
  const allTags = useMemo(() => {
    const tags = new Set<string>()
    contacts.forEach(c => c.tags?.forEach(t => tags.add(t)))
    return Array.from(tags).sort()
  }, [contacts])

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(0) }}
            placeholder="Search contacts, companies, tags..."
            className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-gray-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-teal/30 focus:border-np-blue placeholder:text-gray-400"
          />
        </div>

        {/* Stage Filter */}
        <select
          value={stageFilter}
          onChange={e => { setStageFilter(e.target.value); setPage(0) }}
          className="text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal/30"
        >
          <option value="">All Stages</option>
          {PIPELINE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Tag Filter */}
        <select
          value={tagFilter}
          onChange={e => { setTagFilter(e.target.value); setPage(0) }}
          className="text-xs bg-white border border-gray-100 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-teal/30"
        >
          <option value="">All Tags</option>
          {allTags.map(t => <option key={t} value={t}>{t}</option>)}
        </select>

        {/* Actions */}
        <Link
          href="/crm/contacts?new=true"
          className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark transition-colors"
        >
          <Plus size={13} /> Add Contact
        </Link>
      </div>

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-np-blue/5 border border-np-blue/20 rounded-lg animate-in slide-in-from-top duration-200">
          <span className="text-xs font-semibold text-np-blue">{selected.size} selected</span>
          <div className="flex gap-1 ml-auto">
            <button
              onClick={() => handleBulkAction('add_tags', { tags: ['VIP'] })}
              className="px-2 py-1 text-[10px] font-medium bg-white border border-gray-100 rounded-md hover:bg-gray-50"
            >
              <Tag size={10} className="inline mr-0.5" /> Add Tag
            </button>
            <button
              onClick={() => {
                const stage = prompt('Enter pipeline stage:')
                if (stage) handleBulkAction('set_pipeline_stage', { pipeline_stage: stage })
              }}
              className="px-2 py-1 text-[10px] font-medium bg-white border border-gray-100 rounded-md hover:bg-gray-50"
            >
              Set Stage
            </button>
            <button
              onClick={() => handleBulkAction('add_to_dnc', {})}
              className="px-2 py-1 text-[10px] font-medium bg-red-50 border border-red-200 text-red-600 rounded-md hover:bg-red-100"
            >
              DNC
            </button>
            <button onClick={() => setSelected(new Set())} className="px-2 py-1 text-[10px] text-gray-400 hover:text-np-dark">
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Count */}
      <p className="text-[10px] text-gray-400">{total} contacts</p>

      {/* Table */}
      <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="w-8 py-2 px-3">
                  <input
                    type="checkbox"
                    checked={selected.size === contacts.length && contacts.length > 0}
                    onChange={toggleAll}
                    className="accent-teal w-3 h-3"
                  />
                </th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Name</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Company</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Source</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Stage</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Tags</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Last Contact</th>
                <th className="py-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Assigned</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map(c => {
                const initials = `${c.first_name?.[0] || ''}${c.last_name?.[0] || ''}`.toUpperCase()
                const stageColor = STAGE_COLORS[c.pipeline_stage || ''] || '#94a3b8'
                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedContactId(c.id)}
                    className="border-b border-gray-100/30 hover:bg-gray-50/30 transition-colors cursor-pointer"
                  >
                    <td className="py-2 px-3" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleSelect(c.id)}
                        className="accent-teal w-3 h-3"
                      />
                    </td>
                    <td className="py-2 px-3">
                      <Link href={`/crm/contacts?id=${c.id}`} className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal to-np-dark flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                          {initials}
                        </div>
                        <div>
                          <p className="text-xs font-semibold text-np-dark">{c.first_name} {c.last_name}</p>
                          <p className="text-[10px] text-gray-400">{c.email}</p>
                        </div>
                      </Link>
                    </td>
                    <td className="py-2 px-3 text-xs text-gray-600">{c.custom_fields?.company as string || '--'}</td>
                    <td className="py-2 px-3">
                      <span className="text-[10px] px-1.5 py-0.5 bg-np-blue-muted text-np-blue rounded-full font-medium">
                        {c.source || '--'}
                      </span>
                    </td>
                    <td className="py-2 px-3">
                      {c.pipeline_stage ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium" style={{ background: stageColor + '18', color: stageColor }}>
                          {c.pipeline_stage}
                        </span>
                      ) : <span className="text-[10px] text-gray-400">--</span>}
                    </td>
                    <td className="py-2 px-3">
                      <div className="flex gap-0.5 flex-wrap">
                        {c.tags?.slice(0, 2).map(t => <ContactTag key={t} tag={t} />)}
                        {(c.tags?.length || 0) > 2 && (
                          <span className="text-[9px] text-gray-400">+{c.tags!.length - 2}</span>
                        )}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-[10px] text-gray-400">
                      {c.last_contacted_at
                        ? new Date(c.last_contacted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : 'Never'}
                    </td>
                    <td className="py-2 px-3 text-[10px] text-gray-600">
                      {(c.assigned_member as any)?.display_name || '--'}
                    </td>
                  </tr>
                )
              })}
              {contacts.length === 0 && !loading && (
                <tr><td colSpan={8} className="py-12 text-center text-xs text-gray-400">No contacts found</td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="py-12 text-center text-xs text-gray-400">Loading...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-[10px] text-gray-400">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </p>
          <div className="flex gap-1">
            <button
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50"
            >
              Prev
            </button>
            <button
              disabled={(page + 1) * limit >= total}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 text-xs border border-gray-100 rounded-md disabled:opacity-30 hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
      {/* Contact Detail Drawer */}
      <ContactDetail
        contactId={selectedContactId}
        onClose={() => setSelectedContactId(null)}
        onUpdate={load}
      />
    </div>
  )
}
