'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useWorkspace } from '@/lib/workspace-context'
import { createClient } from '@/lib/supabase-browser'
import {
  Camera, Package, Search, X, Loader2, CheckCircle2, AlertTriangle,
  ChevronDown, ArrowLeft, Keyboard, RotateCcw, Upload,
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

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => { setCsvText(ev.target?.result as string || '') }
    reader.readAsText(file)
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

  // Fetch equipment list
  const fetchEquipment = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    try {
      const res = await fetch(`/api/equipment?org_id=${currentOrg.id}`)
      const data = await res.json()
      if (data.equipment) setEquipment(data.equipment)
    } catch {}
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
    setScanProcessing(true)
    setScanError('')

    const video = videoRef.current
    const canvas = canvasRef.current
    // Resize to max 1024px
    const scale = Math.min(1024 / video.videoWidth, 1024 / video.videoHeight, 1)
    canvas.width = video.videoWidth * scale
    canvas.height = video.videoHeight * scale
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const base64 = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]

    try {
      const res = await fetch('/api/equipment/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: base64, media_type: 'image/jpeg', org_id: currentOrg.id }),
      })
      const data = await res.json()
      if (data.error) { setScanError(data.error); setScanProcessing(false); return }
      setScanResult(data)

      // Auto-lookup first serial found
      if (data.serials?.length > 0) {
        await lookupSerial(data.serials[0].value)
      } else {
        setScanError('No serial numbers detected. Try again or use manual entry.')
      }
    } catch (e: any) {
      setScanError('Scan failed: ' + (e.message || 'Unknown error'))
    }
    setScanProcessing(false)
  }

  // Manual serial lookup
  const handleManualLookup = async () => {
    if (!manualSerial.trim()) return
    setScanProcessing(true)
    setScanError('')
    await lookupSerial(manualSerial.trim())
    setScanProcessing(false)
  }

  // Lookup serial in DB
  const lookupSerial = async (serial: string) => {
    if (!currentOrg) return
    try {
      const res = await fetch(`/api/equipment/lookup?serial=${encodeURIComponent(serial)}&org_id=${currentOrg.id}`)
      const data = await res.json()
      setLookupResult(data)
      if (!data.equipment) {
        setScanError(`No equipment found for serial: ${serial}`)
      }
    } catch {
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
              <div className="flex-1 relative">
                <video ref={videoRef} className="w-full h-full object-cover" autoPlay playsInline muted />
                {/* Viewfinder overlay */}
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-72 h-44 border-2 border-white/60 rounded-xl" />
                </div>
                {/* Capture button */}
                <div className="absolute bottom-8 left-0 right-0 flex justify-center">
                  <button onClick={captureAndScan} disabled={scanProcessing}
                    className="w-16 h-16 rounded-full bg-white flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50">
                    {scanProcessing
                      ? <Loader2 className="w-7 h-7 text-gray-800 animate-spin" />
                      : <Camera className="w-7 h-7 text-gray-800" />
                    }
                  </button>
                </div>
              </div>
            )}

            {/* Error */}
            {scanError && (
              <div className="mx-4 mb-2 p-3 bg-red-500/90 text-white rounded-xl text-sm flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" /> {scanError}
                <button onClick={() => setScanError('')} className="ml-auto"><X className="w-4 h-4" /></button>
              </div>
            )}

            {/* Scan result + serials */}
            {scanResult && scanResult.serials.length > 0 && !lookupResult && (
              <div className="mx-4 mb-2 p-3 bg-gray-900 rounded-xl">
                <p className="text-xs text-gray-400 mb-1">Detected serials:</p>
                {scanResult.serials.map((s, i) => (
                  <button key={i} onClick={() => lookupSerial(s.value)}
                    className="block w-full text-left px-3 py-2 bg-gray-800 rounded-lg text-white font-mono text-sm mb-1 hover:bg-gray-700">
                    {s.type}: {s.value}
                  </button>
                ))}
              </div>
            )}

            {/* Lookup result — Equipment found */}
            {lookupResult?.equipment && (
              <div className="mx-4 mb-4 p-4 bg-gray-900 rounded-xl max-h-[60vh] overflow-y-auto">
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
              CSV columns: <code className="text-[10px] bg-gray-100 px-1 rounded">device_id, device_type, bundle_serial, headset_serial, status, meta_account_email, location, notes</code>
            </p>
            <div className="flex gap-2 mb-3">
              <button onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 rounded-lg text-xs font-medium hover:bg-gray-50">
                <Upload className="w-3.5 h-3.5" /> Choose File
              </button>
              <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCsvFile} className="hidden" />
              <span className="text-xs text-gray-400 self-center">or paste CSV below</span>
            </div>
            <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
              rows={8} placeholder="device_id,device_type,bundle_serial,headset_serial,status,meta_account_email,location,notes&#10;NP-MQ0001,meta_quest,340YB0FGBV0G9K,340YC10GBQ01CK,available,quest1@np.com,Office,"
              className="w-full px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 mb-3" />
            {importResult && (
              <div className={`p-3 rounded-lg mb-3 text-xs ${importResult.imported ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {importResult.imported && <p className="font-medium">{importResult.imported} devices imported successfully</p>}
                {importResult.errors?.map((e, i) => <p key={i}>{e}</p>)}
              </div>
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
              <div key={e.id} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4">
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
                    {e.status === 'checked_out' && e.contact_first_name && (
                      <span className="text-[10px] text-blue-500 font-medium">
                        {e.contact_first_name} {e.contact_last_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
