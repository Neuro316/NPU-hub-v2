'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Camera, Package, Search, X, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ArrowLeft, Keyboard, RotateCcw, Upload, Clock, ArrowRight, User, Trash2,
} from 'lucide-react'
import type { Equipment, SerialScanResult } from '@/lib/types/equipment'
import { EQUIPMENT_STATUS_CONFIG, CONDITION_OPTIONS } from '@/lib/types/equipment'

// Pipeline stage priority for sorting eligible contacts
const STAGE_PRIORITY: Record<string, number> = { Mastermind: 0, Subscribed: 1, Enrolled: 2 }
const ELIGIBLE_STAGES = ['Mastermind', 'Subscribed', 'Enrolled']

interface EligibleContact {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  pipeline_stage: string
}

export default function EquipmentPage() {
  const { currentOrg, user } = useWorkspace()
  const supabase = createClient()

  // List state
  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')

  // Scan state
  const [scanning, setScanning] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)
  const [manualSerial, setManualSerial] = useState('')
  const [scanProcessing, setScanProcessing] = useState(false)
  const [scanResult, setScanResult] = useState<SerialScanResult | null>(null)
  const [lookupResult, setLookupResult] = useState<{ equipment: Equipment | null; current_assignment: any } | null>(null)
  const [scanError, setScanError] = useState('')
  const [scanStatus, setScanStatus] = useState('')
  const [registerSerials, setRegisterSerials] = useState<{ value: string; type: string }[]>([])
  const [registerDeviceId, setRegisterDeviceId] = useState('')
  const [registerLoading, setRegisterLoading] = useState(false)

  // Camera state
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Checkout/Checkin state
  const [contacts, setContacts] = useState<EligibleContact[]>([])
  const [selectedContact, setSelectedContact] = useState('')
  const [purpose, setPurpose] = useState('')
  const [conditionOut, setConditionOut] = useState('good')
  const [conditionIn, setConditionIn] = useState('good')
  const [checkinNotes, setCheckinNotes] = useState('')
  const [actionLoading, setActionLoading] = useState(false)
  const [actionSuccess, setActionSuccess] = useState('')
  const [contactSearch, setContactSearch] = useState('')

  // Import state
  const [showImport, setShowImport] = useState(false)
  const [csvText, setCsvText] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ imported?: number; errors?: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Detail view state
  const [selectedDevice, setSelectedDevice] = useState<Equipment | null>(null)
  const [deviceAssignments, setDeviceAssignments] = useState<any[]>([])
  const [deviceHistory, setDeviceHistory] = useState<any[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const openDeviceDetail = (device: Equipment) => {
    setSelectedDevice(device)
    setDeviceAssignments([])
    setDeviceHistory([])
    setDetailLoading(true)

    // Load history via API to bypass RLS
    fetch(`/api/equipment/history?equipment_id=${device.id}`)
      .then(res => res.json())
      .then(data => {
        setDeviceAssignments(data.assignments || [])
        setDeviceHistory(data.history || [])
      })
      .catch(e => console.error('[Equipment] detail load error:', e))
      .finally(() => setDetailLoading(false))
  }

  const handleDeleteEquipment = async (id: string) => {
    if (!confirm('Delete this equipment? This will remove all assignment history.')) return
    try {
      const res = await fetch(`/api/equipment?id=${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (data.error) { alert('Delete failed: ' + data.error); return }
      setSelectedDevice(null)
      setEquipment(prev => prev.filter(e => e.id !== id))
    } catch (e: any) {
      alert('Delete failed: ' + e.message)
    }
  }

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { setCsvText(ev.target?.result as string || '') }
    reader.readAsText(file)
  }

  const downloadTemplate = () => {
    const template = `device_id,device_type,bundle_serial,headset_serial,status,assigned_to_name,meta_account_email,location,notes
NP-MQ0001,meta_quest,340YB0FGBV0G9K,340YC10GBQ01CK,available,,quest1@neuroprogeny.com,Office,
NP-MQ0002,meta_quest,340YBMMGCB0PN4,340YC10GC205LS,checked_out,John Smith,quest2@neuroprogeny.com,Office,Currently in use
NP-MQ0003,meta_quest,,,maintenance,,,,Missing serial stickers`
    const blob = new Blob([template], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'equipment-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = async () => {
    if (!csvText.trim() || !currentOrg) return
    setImporting(true)
    setImportResult(null)
    try {
      const res = await fetch('/api/equipment/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: currentOrg.id, csv_text: csvText }),
      })
      const data = await res.json()
      if (data.error) { setImportResult({ errors: [data.error] }); setImporting(false); return }
      setImportResult(data)
      if (data.imported > 0) {
        fetchEquipment()
        setTimeout(() => { setShowImport(false); setCsvText(''); setImportResult(null) }, 2000)
      }
    } catch (e: any) {
      setImportResult({ errors: [e.message] })
    }
    setImporting(false)
  }

  // Fetch equipment list via API route (uses service role, bypasses RLS)
  const fetchEquipment = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    try {
      const res = await fetch(`/api/equipment?org_id=${currentOrg.id}`)
      const data = await res.json()
      if (data.error) { console.error('[Equipment] fetch error:', data.error) }
      else if (data.equipment) { setEquipment(data.equipment) }
    } catch (e) { console.error('[Equipment] fetch error:', e) }
    setLoading(false)
  }, [currentOrg?.id])

  useEffect(() => { fetchEquipment() }, [fetchEquipment])

  // Fetch eligible contacts
  useEffect(() => {
    if (!currentOrg) return
    supabase
      .from('contacts')
      .select('id, first_name, last_name, phone, pipeline_stage')
      .eq('org_id', currentOrg.id)
      .in('pipeline_stage', ELIGIBLE_STAGES)
      .is('archived_at', null)
      .order('last_name')
      .then(({ data }) => {
        if (data) {
          const sorted = data.sort((a: any, b: any) =>
            (STAGE_PRIORITY[a.pipeline_stage] ?? 99) - (STAGE_PRIORITY[b.pipeline_stage] ?? 99)
          )
          setContacts(sorted)
        }
      })
  }, [currentOrg?.id])

  // Camera management
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
      }
    } catch (e) {
      setScanError('Camera access denied. Use manual entry instead.')
      setManualEntry(true)
    }
  }

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const openScanner = () => {
    setScanning(true)
    setManualEntry(false)
    setScanResult(null)
    setLookupResult(null)
    setScanError('')
    setActionSuccess('')
    setSelectedContact('')
    setPurpose('')
    setConditionOut('good')
    setConditionIn('good')
    setCheckinNotes('')
    setManualSerial('')
    setRegisterSerials([])
    setTimeout(startCamera, 100)
  }

  const closeScanner = () => {
    stopCamera()
    setScanning(false)
    setScanResult(null)
    setLookupResult(null)
    setScanError('')
    fetchEquipment()
  }

  // Capture image and send to AI
  const captureAndScan = async () => {
    if (!videoRef.current || !canvasRef.current || !currentOrg) return

    const video = videoRef.current
    // Wait for video to have actual dimensions
    if (!video.videoWidth || !video.videoHeight) {
      setScanError('Camera not ready yet. Wait a moment and try again.')
      return
    }

    setScanProcessing(true)
    setScanError('')

    const canvas = canvasRef.current
    // Resize to max 640px to keep payload small and fast
    const scale = Math.min(640 / video.videoWidth, 640 / video.videoHeight, 1)
    canvas.width = Math.round(video.videoWidth * scale)
    canvas.height = Math.round(video.videoHeight * scale)
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7)
    const base64 = dataUrl.split(',')[1]
    if (!base64 || base64.length < 100) {
      setScanError('Failed to capture image. Try again.')
      setScanProcessing(false)
      return
    }

    try {
      setScanStatus('Sending image to AI...')
      console.log('[Equipment] Sending scan request, image size:', Math.round(base64.length / 1024), 'KB')
      const res = await fetch('/api/equipment/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, media_type: 'image/jpeg', org_id: currentOrg.id }),
      })

      if (!res.ok) {
        let errMsg = `Scan failed (${res.status})`
        try {
          const errData = await res.json()
          errMsg = errData.error || errMsg
        } catch {
          const errText = await res.text().catch(() => '')
          if (errText) errMsg = errText.substring(0, 150)
        }
        console.error('[Equipment] Scan API error:', res.status, errMsg)
        setScanError(errMsg)
        setScanProcessing(false)
        setScanStatus('')
        return
      }

      const data = await res.json()
      console.log('[Equipment] Scan result:', data)

      if (data.error) { setScanError(data.error); setScanProcessing(false); setScanStatus(''); return }
      setScanResult(data)

      // Auto-lookup first serial found
      if (data.serials?.length > 0) {
        setScanStatus('Serial found! Looking up device...')
        await lookupSerial(data.serials[0].value)
      } else {
        setScanError('No serial numbers detected. Try again or use manual entry.')
      }
    } catch (e: any) {
      console.error('[Equipment] Scan failed:', e)
      setScanError('Scan failed: ' + (e.message || 'Unknown error'))
    }
    setScanProcessing(false)
    setScanStatus('')
  }

  // Manual serial lookup
  const handleManualLookup = async () => {
    if (!manualSerial.trim()) return
    setScanProcessing(true)
    setScanError('')
    await lookupSerial(manualSerial.trim())
    setScanProcessing(false)
  }

  // Lookup serial in DB (direct Supabase query)
  const lookupSerial = async (serial: string) => {
    if (!currentOrg) return
    try {
      const { data: equip } = await supabase
        .from('equipment')
        .select('*')
        .eq('org_id', currentOrg.id)
        .or(`bundle_serial.eq.${serial},headset_serial.eq.${serial}`)
        .maybeSingle()

      if (!equip) {
        setLookupResult({ equipment: null, current_assignment: null })
        // Store serial for registration
        const allSerials = scanResult?.serials || [{ value: serial, type: serial.match(/40Y[BC]|497[BC]/) ? (serial.includes('40YB') || serial.includes('497B') ? 'bundle' : 'headset') : 'bundle' }]
        setRegisterSerials(allSerials)
        setRegisterDeviceId('')
        return
      }

      // Enrich with contact info
      let enriched: any = { ...equip }
      if (equip.assigned_to) {
        const { data: contact } = await supabase
          .from('contacts').select('first_name, last_name, phone, pipeline_stage').eq('id', equip.assigned_to).maybeSingle()
        if (contact) {
          enriched.contact_first_name = contact.first_name
          enriched.contact_last_name = contact.last_name
          enriched.contact_phone = contact.phone
          enriched.contact_pipeline_stage = contact.pipeline_stage
        }
      }

      // Get current assignment if checked out
      let current_assignment = null
      if (equip.status === 'checked_out') {
        const { data: assign } = await supabase
          .from('equipment_assignments')
          .select('*')
          .eq('equipment_id', equip.id)
          .is('checked_in_at', null)
          .order('checked_out_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (assign) {
          const { data: aContact } = await supabase
            .from('contacts').select('first_name, last_name').eq('id', assign.assigned_to_contact_id).maybeSingle()
          current_assignment = {
            ...assign,
            contact_first_name: aContact?.first_name || null,
            contact_last_name: aContact?.last_name || null,
          }
        }
      }

      setLookupResult({ equipment: enriched, current_assignment })
    } catch (e) {
      console.error('[Equipment] lookup error:', e)
      setScanError('Lookup failed')
    }
  }

  // Checkout
  const handleCheckout = async () => {
    if (!lookupResult?.equipment || !selectedContact || !currentOrg) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/equipment/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: lookupResult.equipment.id,
          contact_id: selectedContact,
          org_id: currentOrg.id,
          purpose,
          condition_out: conditionOut,
        }),
      })
      const data = await res.json()
      if (data.error) { setScanError(data.error); setActionLoading(false); return }
      setActionSuccess(`Checked out to ${data.contact_name}`)
      setLookupResult(null)
    } catch (e: any) {
      setScanError(e.message)
    }
    setActionLoading(false)
  }

  // Checkin
  const handleCheckin = async () => {
    if (!lookupResult?.equipment) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/equipment/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipment_id: lookupResult.equipment.id,
          condition_in: conditionIn,
          notes: checkinNotes,
        }),
      })
      const data = await res.json()
      if (data.error) { setScanError(data.error); setActionLoading(false); return }
      setActionSuccess('Equipment checked in successfully')
      setLookupResult(null)
    } catch (e: any) {
      setScanError(e.message)
    }
    setActionLoading(false)
  }

  // Register new equipment from scan
  const handleRegister = async () => {
    if (!currentOrg) return
    setRegisterLoading(true)
    const bundleSerial = registerSerials.find(s => s.type === 'bundle')?.value || null
    const headsetSerial = registerSerials.find(s => s.type === 'headset')?.value || null
    try {
      const res = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          org_id: currentOrg.id,
          device_id: registerDeviceId.trim() || null,
          device_type: 'meta_quest',
          bundle_serial: bundleSerial,
          headset_serial: headsetSerial,
        }),
      })
      const data = await res.json()
      if (data.error) { setScanError(data.error); setRegisterLoading(false); return }
      // Registration successful — now look it up to show checkout form
      setRegisterSerials([])
      setActionSuccess(`Equipment registered! ${registerDeviceId || bundleSerial || 'New device'}`)
      // Add to local list
      setEquipment(prev => [data.equipment, ...prev])
      // Auto-lookup so they can immediately check out
      if (bundleSerial) {
        await lookupSerial(bundleSerial)
      } else if (headsetSerial) {
        await lookupSerial(headsetSerial)
      }
    } catch (e: any) {
      setScanError('Registration failed: ' + e.message)
    }
    setRegisterLoading(false)
  }

  // Stats
  const total = equipment.length
  const available = equipment.filter(e => e.status === 'available').length
  const checkedOut = equipment.filter(e => e.status === 'checked_out').length
  const maintenance = equipment.filter(e => e.status === 'maintenance').length

  const filtered = statusFilter === 'all' ? equipment : equipment.filter(e => e.status === statusFilter)

  const filteredContacts = contactSearch
    ? contacts.filter(c =>
        `${c.first_name} ${c.last_name}`.toLowerCase().includes(contactSearch.toLowerCase()) ||
        c.phone?.includes(contactSearch)
      )
    : contacts

  // ─── SCAN OVERLAY ───
  if (scanning) {
    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 bg-black/80 text-white z-10">
          <button onClick={closeScanner} className="p-2"><ArrowLeft className="w-5 h-5" /></button>
          <span className="text-sm font-semibold">Scan Equipment</span>
          <button onClick={() => { setManualEntry(!manualEntry); if (!manualEntry) stopCamera() }}
            className="p-2"><Keyboard className="w-5 h-5" /></button>
        </div>

        {/* Success banner */}
        {actionSuccess && (
          <div className="mx-4 mt-2 p-3 bg-emerald-500 text-white rounded-xl flex items-center gap-2 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" /> {actionSuccess}
            <button onClick={() => { setActionSuccess(''); setScanResult(null); setLookupResult(null); if (!manualEntry) startCamera() }}
              className="ml-auto text-xs bg-white/20 px-2 py-1 rounded">Scan Next</button>
          </div>
        )}

        {/* Camera or Manual Entry */}
        {!actionSuccess && (
          <>
            {manualEntry ? (
              <div className="flex-1 flex flex-col items-center justify-center p-6">
                <Package className="w-12 h-12 text-gray-500 mb-4" />
                <p className="text-white text-sm mb-4">Enter serial number manually</p>
                <input
                  value={manualSerial}
                  onChange={e => setManualSerial(e.target.value.toUpperCase())}
                  placeholder="e.g. 340YB0FGBV0G9K"
                  className="w-full max-w-sm px-4 py-3 text-center text-lg font-mono bg-gray-900 text-white border border-gray-700 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
                <button onClick={handleManualLookup} disabled={!manualSerial.trim() || scanProcessing}
                  className="mt-4 px-6 py-3 bg-blue-500 text-white rounded-xl font-medium disabled:opacity-40">
                  {scanProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Look Up'}
                </button>
              </div>
            ) : (
              <div className="flex-1 relative overflow-hidden">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 h-44 border-2 border-white/60 rounded-xl" />
                </div>

                {/* Bottom overlay — error, status, capture button, results all layered on camera */}
                <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col items-center gap-3 pb-8"
                  style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.7) 40%)' }}>

                  {/* Error */}
                  {scanError && (
                    <div className="w-full p-3 bg-red-500 text-white rounded-xl text-sm flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                      <span className="flex-1">{scanError}</span>
                      <button onClick={() => setScanError('')}><X className="w-4 h-4" /></button>
                    </div>
                  )}

                  {/* Scan result serials */}
                  {scanResult && scanResult.serials.length > 0 && !lookupResult && (
                    <div className="w-full p-3 bg-gray-900/90 rounded-xl">
                      <p className="text-xs text-gray-400 mb-1">Detected serials:</p>
                      {scanResult.serials.map((s, i) => (
                        <button key={i} onClick={() => lookupSerial(s.value)}
                          className="block w-full text-left px-3 py-2 bg-gray-800 rounded-lg text-white font-mono text-sm mb-1 hover:bg-gray-700">
                          {s.type}: {s.value}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Register new equipment form */}
                  {registerSerials.length > 0 && !lookupResult?.equipment && (
                    <div className="w-full p-4 bg-gray-900/95 rounded-xl">
                      <p className="text-white text-sm font-semibold mb-1">New Equipment Detected</p>
                      <p className="text-gray-400 text-xs mb-3">These serials aren&apos;t registered yet. Register to start tracking.</p>
                      <div className="space-y-1.5 mb-3">
                        {registerSerials.map((s, i) => (
                          <div key={i} className="px-3 py-2 bg-gray-800 rounded-lg text-white font-mono text-xs">
                            {s.type}: {s.value}
                          </div>
                        ))}
                      </div>
                      <input
                        value={registerDeviceId}
                        onChange={e => setRegisterDeviceId(e.target.value)}
                        placeholder="Device ID (e.g. NP-MQ0007)"
                        className="w-full px-3 py-2.5 mb-3 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <button onClick={handleRegister} disabled={registerLoading}
                        className="w-full py-3 bg-blue-500 text-white rounded-xl font-semibold text-sm disabled:opacity-40">
                        {registerLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Register Equipment'}
                      </button>
                      <button onClick={() => setRegisterSerials([])}
                        className="w-full mt-2 py-2 text-gray-400 text-xs hover:text-white">
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Status message */}
                  {scanStatus && (
                    <div className="bg-black/70 text-white text-xs font-medium px-4 py-2 rounded-full">
                      {scanStatus}
                    </div>
                  )}

                  {/* Capture button */}
                  <button onClick={captureAndScan} disabled={scanProcessing}
                    className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50 shadow-lg">
                    {scanProcessing
                      ? <Loader2 className="w-7 h-7 text-gray-800 animate-spin" />
                      : <Camera className="w-7 h-7 text-gray-800" />
                    }
                  </button>
                </div>
              </div>
            )}

            {/* Lookup result — Equipment found (full-screen overlay on camera) */}
            {lookupResult?.equipment && (
              <div className="absolute inset-0 z-10 bg-black/95 overflow-y-auto p-4 pt-16">
                {/* Equipment info */}
                <div className="flex items-center gap-3 mb-3">
                  <Package className="w-5 h-5 text-blue-400" />
                  <div>
                    <p className="text-white font-semibold text-sm">{lookupResult.equipment.device_id || 'Unknown Device'}</p>
                    <p className="text-gray-400 text-xs">{lookupResult.equipment.device_type}</p>
                  </div>
                  <span className="ml-auto text-xs font-bold px-2 py-1 rounded"
                    style={{
                      backgroundColor: EQUIPMENT_STATUS_CONFIG[lookupResult.equipment.status]?.bg,
                      color: EQUIPMENT_STATUS_CONFIG[lookupResult.equipment.status]?.color,
                    }}>
                    {EQUIPMENT_STATUS_CONFIG[lookupResult.equipment.status]?.label}
                  </span>
                </div>

                {lookupResult.equipment.bundle_serial && (
                  <p className="text-xs text-gray-500 font-mono mb-1">Bundle: {lookupResult.equipment.bundle_serial}</p>
                )}
                {lookupResult.equipment.headset_serial && (
                  <p className="text-xs text-gray-500 font-mono mb-2">Headset: {lookupResult.equipment.headset_serial}</p>
                )}

                {/* CHECKOUT FORM */}
                {lookupResult.equipment.status === 'available' && (
                  <div className="border-t border-gray-800 pt-3 mt-3">
                    <p className="text-white text-xs font-semibold mb-2">Check Out To:</p>
                    <input value={contactSearch} onChange={e => setContactSearch(e.target.value)}
                      placeholder="Search contacts..."
                      className="w-full px-3 py-2 mb-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                    <select value={selectedContact} onChange={e => setSelectedContact(e.target.value)}
                      className="w-full px-3 py-2.5 bg-gray-800 text-white text-sm rounded-lg border border-gray-700 mb-2">
                      <option value="">Select a contact...</option>
                      {filteredContacts.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.first_name} {c.last_name} — {c.pipeline_stage}{c.phone ? ` (${c.phone})` : ''}
                        </option>
                      ))}
                    </select>
                    <input value={purpose} onChange={e => setPurpose(e.target.value)}
                      placeholder="Purpose (optional)"
                      className="w-full px-3 py-2 mb-2 bg-gray-800 text-white text-sm rounded-lg border border-gray-700" />
                    <div className="flex gap-2 mb-3">
                      {CONDITION_OPTIONS.map(c => (
                        <button key={c.value} onClick={() => setConditionOut(c.value)}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                            conditionOut === c.value ? 'bg-blue-500/20 border-blue-500 text-blue-400' : 'bg-gray-800 border-gray-700 text-gray-400'
                          }`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <button onClick={handleCheckout} disabled={!selectedContact || actionLoading}
                      className="w-full py-3 bg-blue-500 text-white rounded-xl font-semibold text-sm disabled:opacity-40">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Assign Equipment'}
                    </button>
                  </div>
                )}

                {/* CHECKIN FORM */}
                {lookupResult.equipment.status === 'checked_out' && (
                  <div className="border-t border-gray-800 pt-3 mt-3">
                    <p className="text-yellow-400 text-xs mb-2">
                      Currently with: <span className="font-semibold text-white">
                        {lookupResult.current_assignment
                          ? `${lookupResult.current_assignment.contact_first_name || ''} ${lookupResult.current_assignment.contact_last_name || ''}`.trim()
                          : `${lookupResult.equipment.contact_first_name || ''} ${lookupResult.equipment.contact_last_name || ''}`.trim() || 'Unknown'}
                      </span>
                      {lookupResult.current_assignment?.checked_out_at && (
                        <span className="text-gray-500"> since {new Date(lookupResult.current_assignment.checked_out_at).toLocaleDateString()}</span>
                      )}
                    </p>
                    <div className="flex gap-2 mb-2">
                      {CONDITION_OPTIONS.map(c => (
                        <button key={c.value} onClick={() => setConditionIn(c.value)}
                          className={`flex-1 py-2 text-xs font-medium rounded-lg border ${
                            conditionIn === c.value ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' : 'bg-gray-800 border-gray-700 text-gray-400'
                          }`}>
                          {c.label}
                        </button>
                      ))}
                    </div>
                    <input value={checkinNotes} onChange={e => setCheckinNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      className="w-full px-3 py-2 mb-3 bg-gray-800 text-white text-sm rounded-lg border border-gray-700" />
                    <button onClick={handleCheckin} disabled={actionLoading}
                      className="w-full py-3 bg-emerald-500 text-white rounded-xl font-semibold text-sm disabled:opacity-40">
                      {actionLoading ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'Check In Equipment'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <canvas ref={canvasRef} className="hidden" />
      </div>
    )
  }

  // ─── DEFAULT LIST VIEW ───
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark flex items-center gap-2">
            <Package className="w-5 h-5" /> Equipment
          </h1>
          <p className="text-[10px] text-gray-400 mt-0.5">Track Meta Quest headsets &middot; Scan, assign, and manage</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-2.5 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button onClick={openScanner}
            className="flex items-center gap-2 px-4 py-2.5 bg-np-blue text-white rounded-xl text-sm font-medium hover:bg-np-blue/90 active:scale-95 transition-all">
            <Camera className="w-4 h-4" /> Scan Equipment
          </button>
        </div>
      </div>

      {/* Import CSV Modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={() => { setShowImport(false); setCsvText(''); setImportResult(null) }} />
          <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-np-dark">Import Equipment from CSV</h3>
              <button onClick={() => { setShowImport(false); setCsvText(''); setImportResult(null) }}><X className="w-4 h-4 text-gray-400" /></button>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              CSV columns: <code className="text-[10px] bg-gray-100 px-1 rounded">device_id, device_type, bundle_serial, headset_serial, status, assigned_to_name, meta_account_email, location, notes</code>
              <br /><span className="text-gray-400">Use <strong>assigned_to_name</strong> to auto-assign (matches CRM contact by name). Devices with a name are auto-set to checked_out.</span>
            </p>
            <div className="flex gap-2 mb-3">
              <button onClick={downloadTemplate}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50 text-np-blue">
                Download Template
              </button>
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50">
                <Upload className="w-3.5 h-3.5" /> Choose File
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvFile} className="hidden" />
            </div>
            <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
              rows={8} placeholder="device_id,device_type,bundle_serial,headset_serial,status,meta_account_email,location,notes&#10;NP-MQ0001,meta_quest,340YB0FGBV0G9K,340YC10GBQ01CK,available,quest1@np.com,Office,"
              className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 mb-3" />
            {importResult && (
              <>
                {((importResult as any).total > 0 || (importResult as any).imported > 0) && (
                  <div className="p-3 rounded-lg mb-2 text-xs bg-green-50 text-green-700">
                    <p className="font-medium">
                      {(importResult as any).created > 0 && `${(importResult as any).created} created`}
                      {(importResult as any).created > 0 && (importResult as any).updated > 0 && ', '}
                      {(importResult as any).updated > 0 && `${(importResult as any).updated} updated`}
                      {(importResult as any).assigned > 0 && `, ${(importResult as any).assigned} assigned`}
                      {!(importResult as any).created && !(importResult as any).updated && (importResult as any).imported && `${(importResult as any).imported} imported`}
                    </p>
                  </div>
                )}
                {(importResult as any).warnings?.length > 0 && (
                  <div className="p-3 rounded-lg mb-2 text-xs bg-amber-50 text-amber-700">
                    <p className="font-medium mb-1">Warnings (devices still imported):</p>
                    {(importResult as any).warnings.map((w: string, i: number) => <p key={i}>{w}</p>)}
                  </div>
                )}
                {importResult.errors && importResult.errors.length > 0 && (
                  <div className="p-3 rounded-lg mb-2 text-xs bg-red-50 text-red-700">
                    {importResult.errors.map((e, i) => <p key={i}>{e}</p>)}
                  </div>
                )}
              </>
            )}
            <button onClick={handleImport} disabled={!csvText.trim() || importing}
              className="w-full py-2.5 bg-np-blue text-white rounded-lg text-sm font-medium disabled:opacity-40">
              {importing ? 'Importing...' : 'Import Equipment'}
            </button>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', value: total, color: '#64748B' },
          { label: 'Available', value: available, color: '#10B981' },
          { label: 'Checked Out', value: checkedOut, color: '#3B82F6' },
          { label: 'Maintenance', value: maintenance, color: '#F59E0B' },
        ].map(s => (
          <div key={s.label} className="bg-white border border-gray-100 rounded-xl p-4">
            <p className="text-2xl font-bold text-np-dark">{s.value}</p>
            <p className="text-[10px] font-medium uppercase tracking-wider mt-0.5" style={{ color: s.color }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-1.5 mb-4">
        {['all', 'available', 'checked_out', 'maintenance', 'retired'].map(s => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              statusFilter === s ? 'bg-np-blue/10 text-np-blue' : 'text-gray-500 hover:bg-gray-50'
            }`}>
            {s === 'all' ? 'All' : s === 'checked_out' ? 'Checked Out' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Equipment list */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">Loading equipment...</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white border border-gray-100 rounded-2xl p-12 text-center">
          <Package className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-1">No equipment found</p>
          <p className="text-xs text-gray-400">Scan a device to register it, or import via CSV</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(e => {
            const st = EQUIPMENT_STATUS_CONFIG[e.status]
            return (
              <button key={e.id} onClick={() => openDeviceDetail(e)}
                className="w-full text-left bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4 hover:shadow-md hover:border-gray-200 transition-all">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: st.bg }}>
                  <Package className="w-5 h-5" style={{ color: st.color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-np-dark">{e.device_id || 'Unknown'}</span>
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded" style={{ backgroundColor: st.bg, color: st.color }}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {e.bundle_serial && <span className="text-[10px] text-gray-400 font-mono">{e.bundle_serial}</span>}
                    {e.headset_serial && <span className="text-[10px] text-gray-400 font-mono">{e.headset_serial}</span>}
                    {e.status === 'checked_out' && e.contact_first_name && (
                      <span className="text-[10px] text-blue-500 font-medium">
                        {e.contact_first_name} {e.contact_last_name}
                      </span>
                    )}
                  </div>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-300 -rotate-90 flex-shrink-0" />
              </button>
            )
          })}
        </div>
      )}

      {/* Equipment Detail Drawer */}
      {selectedDevice && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-[2px]" onClick={() => setSelectedDevice(null)} />
          <div className="relative w-full max-w-md bg-white shadow-2xl border-l border-gray-100 flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
            {/* Header */}
            <div className="p-4 border-b border-gray-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: EQUIPMENT_STATUS_CONFIG[selectedDevice.status]?.bg }}>
                <Package className="w-5 h-5" style={{ color: EQUIPMENT_STATUS_CONFIG[selectedDevice.status]?.color }} />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-bold text-np-dark">{selectedDevice.device_id || 'Unknown Device'}</h2>
                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: EQUIPMENT_STATUS_CONFIG[selectedDevice.status]?.bg, color: EQUIPMENT_STATUS_CONFIG[selectedDevice.status]?.color }}>
                  {EQUIPMENT_STATUS_CONFIG[selectedDevice.status]?.label}
                </span>
              </div>
              <button onClick={() => handleDeleteEquipment(selectedDevice.id)}
                className="p-1.5 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
              <button onClick={() => setSelectedDevice(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-5">
              {/* Device Info */}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Device Info</p>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type</span>
                    <span className="text-np-dark font-medium">{selectedDevice.device_type}</span>
                  </div>
                  {selectedDevice.bundle_serial && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Bundle Serial</span>
                      <span className="text-np-dark font-mono text-[11px]">{selectedDevice.bundle_serial}</span>
                    </div>
                  )}
                  {selectedDevice.headset_serial && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Headset Serial</span>
                      <span className="text-np-dark font-mono text-[11px]">{selectedDevice.headset_serial}</span>
                    </div>
                  )}
                  {selectedDevice.meta_account_email && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Meta Account</span>
                      <span className="text-np-dark">{selectedDevice.meta_account_email}</span>
                    </div>
                  )}
                  {selectedDevice.location && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Location</span>
                      <span className="text-np-dark">{selectedDevice.location}</span>
                    </div>
                  )}
                  {selectedDevice.notes && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Notes</span>
                      <span className="text-np-dark">{selectedDevice.notes}</span>
                    </div>
                  )}
                </div>
              </div>

              {detailLoading ? (
                <div className="text-center py-8 text-gray-400 text-xs">Loading history...</div>
              ) : (
                <>
                  {/* Assignment History */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                      Assignment History ({deviceAssignments.length})
                    </p>
                    {deviceAssignments.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No assignments yet</p>
                    ) : (
                      <div className="space-y-2">
                        {deviceAssignments.map((a: any) => {
                          const contactName = a.contacts
                            ? `${a.contacts.first_name || ''} ${a.contacts.last_name || ''}`.trim()
                            : 'Unknown'
                          const isActive = !a.checked_in_at
                          return (
                            <div key={a.id} className={`border rounded-lg p-3 ${isActive ? 'border-blue-200 bg-blue-50/50' : 'border-gray-100 bg-gray-50/50'}`}>
                              <div className="flex items-center gap-2 mb-1">
                                <User className="w-3.5 h-3.5 text-gray-400" />
                                <span className={`text-xs font-semibold ${isActive ? 'text-blue-700' : 'text-np-dark'}`}>{contactName}</span>
                                {a.contacts?.pipeline_stage && (
                                  <span className="text-[9px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{a.contacts.pipeline_stage}</span>
                                )}
                                {isActive && <span className="text-[9px] font-bold text-blue-500 ml-auto">ACTIVE</span>}
                              </div>
                              <div className="flex items-center gap-1 text-[10px] text-gray-500">
                                <Clock className="w-3 h-3" />
                                <span>Out: {new Date(a.checked_out_at).toLocaleDateString()}</span>
                                {a.checked_in_at && (
                                  <>
                                    <ArrowRight className="w-3 h-3" />
                                    <span>In: {new Date(a.checked_in_at).toLocaleDateString()}</span>
                                  </>
                                )}
                              </div>
                              <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                                {a.condition_out && <span>Condition out: {a.condition_out}</span>}
                                {a.condition_in && <span>Condition in: {a.condition_in}</span>}
                              </div>
                              {a.purpose && <p className="text-[10px] text-gray-400 mt-1">Purpose: {a.purpose}</p>}
                              {a.notes && <p className="text-[10px] text-gray-400 mt-0.5">Notes: {a.notes}</p>}
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Activity Log */}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
                      Activity Log ({deviceHistory.length})
                    </p>
                    {deviceHistory.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">No activity logged</p>
                    ) : (
                      <div className="space-y-1">
                        {deviceHistory.map((h: any) => {
                          const contactName = h.contacts
                            ? `${h.contacts.first_name || ''} ${h.contacts.last_name || ''}`.trim()
                            : null
                          return (
                            <div key={h.id} className="flex items-start gap-2 py-1.5 border-b border-gray-50 last:border-0">
                              <div className="w-1.5 h-1.5 rounded-full bg-gray-300 mt-1.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-np-dark">
                                  <span className="font-medium capitalize">{h.action.replace(/_/g, ' ')}</span>
                                  {contactName && <span className="text-gray-500"> — {contactName}</span>}
                                </p>
                                {h.notes && <p className="text-[10px] text-gray-400">{h.notes}</p>}
                                <p className="text-[10px] text-gray-400">{new Date(h.created_at).toLocaleString()}</p>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
