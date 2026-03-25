'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase-browser'
import { Package, Clock, ArrowRight, CheckCircle2 } from 'lucide-react'
import { EQUIPMENT_STATUS_CONFIG } from '@/lib/types/equipment'
import type { EquipmentAssignment } from '@/lib/types/equipment'

interface Props {
  contactId: string
}

interface AssignmentRow extends EquipmentAssignment {
  equipment?: {
    device_id: string | null
    device_type: string
    bundle_serial: string | null
    headset_serial: string | null
    status: string
  }
}

export function ContactEquipmentTab({ contactId }: Props) {
  const [assignments, setAssignments] = useState<AssignmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()

  useEffect(() => {
    if (!contactId) return
    setLoading(true)
    supabase
      .from('equipment_assignments')
      .select('*, equipment(device_id, device_type, bundle_serial, headset_serial, status)')
      .eq('assigned_to_contact_id', contactId)
      .order('checked_out_at', { ascending: false })
      .then(({ data }) => {
        setAssignments((data || []) as AssignmentRow[])
        setLoading(false)
      })
  }, [contactId])

  const current = assignments.filter(a => !a.checked_in_at)
  const past = assignments.filter(a => a.checked_in_at)

  if (loading) {
    return <div className="text-center py-8 text-gray-400 text-xs">Loading equipment history...</div>
  }

  if (assignments.length === 0) {
    return (
      <div className="text-center py-12">
        <Package className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No equipment assignments</p>
        <p className="text-xs text-gray-400 mt-1">Equipment checked out to this contact will appear here</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Currently checked out */}
      {current.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Currently Assigned</p>
          <div className="space-y-2">
            {current.map(a => {
              const st = EQUIPMENT_STATUS_CONFIG[a.equipment?.status as keyof typeof EQUIPMENT_STATUS_CONFIG] || EQUIPMENT_STATUS_CONFIG.checked_out
              return (
                <div key={a.id} className="border border-blue-200 bg-blue-50/50 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Package className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-semibold text-np-dark">{a.equipment?.device_id || 'Unknown'}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded ml-auto" style={{ backgroundColor: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                  {a.equipment?.bundle_serial && (
                    <p className="text-[10px] text-gray-500 font-mono">SN: {a.equipment.bundle_serial}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Since {new Date(a.checked_out_at).toLocaleDateString()}
                    </span>
                    {a.purpose && <span>Purpose: {a.purpose}</span>}
                    {a.condition_out && <span>Condition: {a.condition_out}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Past assignments */}
      {past.length > 0 && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Past Assignments ({past.length})</p>
          <div className="space-y-1.5">
            {past.map(a => (
              <div key={a.id} className="border border-gray-100 rounded-lg p-3 bg-gray-50/50">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-xs font-medium text-np-dark">{a.equipment?.device_id || 'Unknown'}</span>
                  {a.equipment?.bundle_serial && (
                    <span className="text-[10px] text-gray-400 font-mono ml-auto">{a.equipment.bundle_serial}</span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-gray-500">
                  <span>{new Date(a.checked_out_at).toLocaleDateString()}</span>
                  <ArrowRight className="w-3 h-3" />
                  <span>{new Date(a.checked_in_at!).toLocaleDateString()}</span>
                  {a.condition_in && <span className="ml-2">Returned: {a.condition_in}</span>}
                </div>
                {a.notes && <p className="text-[10px] text-gray-400 mt-1">{a.notes}</p>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
