'use client'

import { useState, useEffect } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Loader2, Trash2, Clock, FileSpreadsheet, CheckCircle2, AlertTriangle,
  Undo2, ChevronDown, ChevronRight, Users, Upload
} from 'lucide-react'
import Link from 'next/link'

interface ImportBatch {
  id: string
  filename: string | null
  total_rows: number
  imported_rows: number
  skipped_rows: number
  status: string
  column_mapping: Record<string, string>
  notes: string | null
  created_at: string
  imported_by: string | null
}

export default function ImportHistoryPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const [batches, setBatches] = useState<ImportBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedBatch, setExpandedBatch] = useState<string | null>(null)
  const [batchContacts, setBatchContacts] = useState<any[]>([])
  const [undoing, setUndoing] = useState<string | null>(null)

  useEffect(() => {
    if (!currentOrg) return
    const sb = createClient()
    setLoading(true)
    sb.from('contact_import_batches')
      .select('*')
      .eq('org_id', currentOrg.id)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: any }) => {
        setBatches(data || [])
        setLoading(false)
      })
  }, [currentOrg?.id])

  const expandBatch = async (batchId: string) => {
    if (expandedBatch === batchId) { setExpandedBatch(null); return }
    setExpandedBatch(batchId)
    const sb = createClient()
    const { data } = await sb.from('contacts')
      .select('id,first_name,last_name,email,phone,pipeline_stage,contact_type,created_at')
      .eq('import_batch_id', batchId)
      .order('created_at', { ascending: true })
      .limit(100)
    setBatchContacts(data || [])
  }

  const undoBatch = async (batchId: string) => {
    if (!confirm('This will permanently delete all contacts imported in this batch. Connections and notes for these contacts will also be removed. Are you sure?')) return
    setUndoing(batchId)
    const sb = createClient()
    
    // Delete contacts (cascading to relationships, engagement, etc.)
    const { error } = await sb.from('contacts')
      .delete()
      .eq('import_batch_id', batchId)
    
    if (error) {
      alert('Failed to undo import: ' + error.message)
      setUndoing(null)
      return
    }

    // Update batch status
    await sb.from('contact_import_batches')
      .update({ status: 'undone', notes: 'Batch undone by user' })
      .eq('id', batchId)

    // Refresh
    setBatches(prev => prev.map(b => b.id === batchId ? { ...b, status: 'undone' } : b))
    setExpandedBatch(null)
    setUndoing(null)
  }

  if (orgLoading || loading) return (
    <div className="flex items-center justify-center h-[60vh]">
      <Loader2 className="w-6 h-6 text-np-blue animate-spin" />
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-np-dark">Import History</h1>
          <p className="text-xs text-gray-500 mt-0.5">{batches.length} imports</p>
        </div>
        <Link href="/crm/import"
          className="flex items-center gap-1.5 text-[11px] font-medium text-white bg-np-blue px-3 py-2 rounded-lg hover:bg-np-blue/90 transition-colors">
          <Upload className="w-3.5 h-3.5" /> New Import
        </Link>
      </div>

      {batches.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
          <FileSpreadsheet className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-semibold text-np-dark mb-1">No imports yet</p>
          <p className="text-xs text-gray-400">Import contacts from CSV or Excel files</p>
        </div>
      ) : (
        <div className="space-y-2">
          {batches.map(batch => (
            <div key={batch.id} className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => expandBatch(batch.id)}>
                <div className="flex-shrink-0">
                  {batch.status === 'completed' ? (
                    <CheckCircle2 className="w-5 h-5 text-green-500" />
                  ) : batch.status === 'undone' ? (
                    <Undo2 className="w-5 h-5 text-gray-400" />
                  ) : batch.status === 'failed' ? (
                    <AlertTriangle className="w-5 h-5 text-red-500" />
                  ) : (
                    <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-semibold text-np-dark truncate">{batch.filename || 'Unknown file'}</p>
                    <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full ${
                      batch.status === 'completed' ? 'bg-green-50 text-green-600' :
                      batch.status === 'undone' ? 'bg-gray-50 text-gray-400' :
                      batch.status === 'failed' ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'
                    }`}>{batch.status}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[9px] text-gray-400 flex items-center gap-1">
                      <Clock className="w-3 h-3" /> {new Date(batch.created_at).toLocaleString()}
                    </span>
                    <span className="text-[9px] text-green-600 font-medium">{batch.imported_rows} imported</span>
                    {batch.skipped_rows > 0 && (
                      <span className="text-[9px] text-amber-600">{batch.skipped_rows} skipped</span>
                    )}
                    {batch.notes && (
                      <span className="text-[9px] text-purple-600">{batch.notes}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {batch.status === 'completed' && (
                    <button
                      onClick={e => { e.stopPropagation(); undoBatch(batch.id) }}
                      disabled={undoing === batch.id}
                      className="text-[9px] font-medium text-red-500 bg-red-50 px-2 py-1 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-40 flex items-center gap-1">
                      {undoing === batch.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />}
                      Undo Import
                    </button>
                  )}
                  {expandedBatch === batch.id ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                </div>
              </div>

              {expandedBatch === batch.id && (
                <div className="border-t border-gray-100 px-4 py-3">
                  {batchContacts.length === 0 ? (
                    <p className="text-[10px] text-gray-400 text-center py-3">
                      {batch.status === 'undone' ? 'This import was undone. Contacts have been removed.' : 'No contacts found for this batch.'}
                    </p>
                  ) : (
                    <div className="overflow-auto max-h-60">
                      <table className="w-full text-[10px]">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="text-left py-1 text-[8px] font-bold text-gray-400 uppercase">Name</th>
                            <th className="text-left py-1 text-[8px] font-bold text-gray-400 uppercase">Email</th>
                            <th className="text-left py-1 text-[8px] font-bold text-gray-400 uppercase">Type</th>
                            <th className="text-left py-1 text-[8px] font-bold text-gray-400 uppercase">Pipeline</th>
                            <th className="text-left py-1 text-[8px] font-bold text-gray-400 uppercase">Imported</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchContacts.map((c: any) => (
                            <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                              <td className="py-1 font-semibold text-np-dark">{c.first_name} {c.last_name}</td>
                              <td className="py-1 text-gray-500">{c.email || '-'}</td>
                              <td className="py-1">
                                {c.contact_type && (
                                  <span className="text-[8px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded-full">
                                    {c.contact_type.replace(/_/g, ' ')}
                                  </span>
                                )}
                              </td>
                              <td className="py-1 text-gray-500">{c.pipeline_stage || '-'}</td>
                              <td className="py-1 text-gray-400">{new Date(c.created_at).toLocaleDateString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Column mapping used */}
                  {batch.column_mapping && Object.keys(batch.column_mapping).length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-100">
                      <p className="text-[8px] font-bold text-gray-400 uppercase mb-1">Column Mapping Used</p>
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(batch.column_mapping).filter(([_, v]) => v).map(([k, v]) => (
                          <span key={k} className="text-[8px] bg-gray-50 text-gray-500 px-1.5 py-0.5 rounded">
                            {k} → {v}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
