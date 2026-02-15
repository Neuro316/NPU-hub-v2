'use client'

// ═══════════════════════════════════════════════════════════════
// CRM Pipelines — Kanban board with stage columns
// Route: /crm/pipelines
// ═══════════════════════════════════════════════════════════════

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  Plus, MoreHorizontal, Phone, Mail, ChevronDown,
  Sparkles, GripVertical, X, Check, DollarSign
} from 'lucide-react'
import { fetchContacts, updateContact } from '@/lib/crm-client'
import type { CrmContact } from '@/types/crm'
import { PIPELINE_STAGES, STAGE_COLORS } from '@/types/crm'

interface PipelineConfig {
  id: string
  name: string
  stages: { name: string; color: string }[]
}

const DEFAULT_PIPELINE: PipelineConfig = {
  id: 'default',
  name: 'Sales Pipeline',
  stages: PIPELINE_STAGES.map(s => ({ name: s, color: STAGE_COLORS[s] || '#94a3b8' })),
}

function ContactCard({ contact, onMove }: { contact: CrmContact; onMove: (stage: string) => void }) {
  const [showMenu, setShowMenu] = useState(false)
  const initials = `${contact.first_name?.[0] || ''}${contact.last_name?.[0] || ''}`.toUpperCase()
  const value = contact.custom_fields?.value as number | undefined

  return (
    <div className="group relative bg-white rounded-lg border border-gray-100/60 p-3 hover:shadow-md hover:border-np-blue/30 transition-all cursor-pointer">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-teal/80 to-np-dark/80 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <Link href={`/crm/contacts?id=${contact.id}`} className="text-xs font-semibold text-np-dark hover:text-np-blue truncate block">
            {contact.first_name} {contact.last_name}
          </Link>
          {contact.custom_fields?.company && (
            <p className="text-[10px] text-gray-400 truncate">{contact.custom_fields.company as string}</p>
          )}
        </div>
        <button
          onClick={e => { e.stopPropagation(); setShowMenu(!showMenu) }}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-gray-50 transition-all"
        >
          <MoreHorizontal size={12} className="text-gray-400" />
        </button>
      </div>

      {/* Tags + Value */}
      <div className="flex items-center gap-1.5 mt-2">
        {contact.tags?.slice(0, 2).map(t => (
          <span key={t} className="text-[8px] font-semibold px-1 py-0.5 rounded-full bg-np-blue/8 text-np-blue">{t}</span>
        ))}
        <div className="flex-1" />
        {value && (
          <span className="text-[10px] font-semibold text-green-600 flex items-center gap-0.5">
            <DollarSign size={9} />{(value / 1000).toFixed(0)}k
          </span>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-all">
        <button className="p-1 rounded bg-gray-50 hover:bg-np-blue/10 transition-colors" title="Call">
          <Phone size={10} className="text-gray-400" />
        </button>
        <button className="p-1 rounded bg-gray-50 hover:bg-np-blue/10 transition-colors" title="Email">
          <Mail size={10} className="text-gray-400" />
        </button>
      </div>

      {/* Stage move dropdown */}
      {showMenu && (
        <div className="absolute right-0 top-8 z-20 w-36 bg-white rounded-lg shadow-xl border border-gray-100 py-1 animate-in fade-in zoom-in-95 duration-150">
          <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-wider text-gray-400">Move to</p>
          {PIPELINE_STAGES.map(s => (
            <button
              key={s}
              onClick={e => { e.stopPropagation(); onMove(s); setShowMenu(false) }}
              className="w-full text-left px-3 py-1.5 text-[11px] hover:bg-gray-50 transition-colors flex items-center gap-2"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: STAGE_COLORS[s] }} />
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function PipelinesPage() {
  const [contacts, setContacts] = useState<CrmContact[]>([])
  const [loading, setLoading] = useState(true)
  const [activePipeline] = useState<PipelineConfig>(DEFAULT_PIPELINE)

  useEffect(() => {
    async function load() {
      try {
        const res = await fetchContacts({ limit: 500 })
        setContacts(res.contacts)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const moveContact = async (contactId: string, newStage: string) => {
    try {
      await updateContact(contactId, { pipeline_stage: newStage })
      setContacts(prev => prev.map(c => c.id === contactId ? { ...c, pipeline_stage: newStage } : c))
    } catch (e) {
      console.error('Move failed:', e)
    }
  }

  const stageContacts = (stageName: string) =>
    contacts.filter(c => (c.pipeline_stage || 'New Lead') === stageName)

  const stageValue = (stageName: string) =>
    stageContacts(stageName).reduce((s, c) => s + ((c.custom_fields?.value as number) || 0), 0)

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-8 h-8 rounded-lg bg-np-blue/20 animate-pulse" /></div>
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-np-dark">{activePipeline.name}</h2>
          <p className="text-[11px] text-gray-400">{contacts.length} contacts · ${(contacts.reduce((s, c) => s + ((c.custom_fields?.value as number) || 0), 0) / 1000).toFixed(0)}k total value</p>
        </div>
        <button className="flex items-center gap-1.5 px-3 py-2 bg-np-blue/10 text-np-blue text-xs font-medium rounded-lg hover:bg-np-blue/20 transition-colors">
          <Sparkles size={13} /> AI Pipeline Builder
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-3 overflow-x-auto pb-4" style={{ minHeight: 'calc(100vh - 280px)' }}>
        {activePipeline.stages.map(stage => {
          const sContacts = stageContacts(stage.name)
          const sValue = stageValue(stage.name)
          return (
            <div key={stage.name} className="flex-shrink-0 w-64">
              {/* Column Header */}
              <div className="flex items-center gap-2 mb-3 px-1">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: stage.color }} />
                <span className="text-xs font-semibold text-np-dark">{stage.name}</span>
                <span className="text-[10px] font-medium text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-full">
                  {sContacts.length}
                </span>
                <div className="flex-1" />
                {sValue > 0 && (
                  <span className="text-[10px] font-medium text-green-600">${(sValue / 1000).toFixed(0)}k</span>
                )}
              </div>

              {/* Column Body */}
              <div
                className="space-y-2 min-h-[200px] rounded-xl bg-gray-50/50 p-2 border border-gray-100/30"
              >
                {sContacts.map(c => (
                  <ContactCard key={c.id} contact={c} onMove={s => moveContact(c.id, s)} />
                ))}
                {sContacts.length === 0 && (
                  <div className="text-center py-8 text-[10px] text-gray-400">
                    No contacts
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
