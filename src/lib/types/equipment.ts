export interface Equipment {
  id: string
  org_id: string
  device_id: string | null
  device_type: string
  bundle_serial: string | null
  headset_serial: string | null
  status: 'available' | 'checked_out' | 'maintenance' | 'retired'
  assigned_to: string | null
  meta_account_email: string | null
  location: string | null
  notes: string | null
  created_at: string
  updated_at: string
  // Joined fields (from contacts)
  contact_first_name?: string
  contact_last_name?: string
  contact_phone?: string
  contact_pipeline_stage?: string
}

export interface EquipmentAssignment {
  id: string
  equipment_id: string
  assigned_to_contact_id: string
  checked_out_at: string
  checked_in_at: string | null
  checked_out_by: string | null
  checked_in_by: string | null
  purpose: string | null
  condition_out: string
  condition_in: string | null
  notes: string | null
  created_at: string
  // Joined
  contact_first_name?: string
  contact_last_name?: string
}

export interface EquipmentHistory {
  id: string
  equipment_id: string
  action: string
  contact_id: string | null
  performed_by: string | null
  notes: string | null
  metadata: Record<string, any>
  created_at: string
}

export interface SerialScanResult {
  serials: { value: string; type: 'bundle' | 'headset' }[]
  raw_text: string
  confidence: number
}

export const EQUIPMENT_STATUS_CONFIG = {
  available: { label: 'Available', color: '#10B981', bg: '#D1FAE5' },
  checked_out: { label: 'Checked Out', color: '#3B82F6', bg: '#DBEAFE' },
  maintenance: { label: 'Maintenance', color: '#F59E0B', bg: '#FEF3C7' },
  retired: { label: 'Retired', color: '#9CA3AF', bg: '#F3F4F6' },
} as const

export const CONDITION_OPTIONS = [
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'damaged', label: 'Damaged' },
] as const
