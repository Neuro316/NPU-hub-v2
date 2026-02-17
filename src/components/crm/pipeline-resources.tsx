'use client'

import { useState, useEffect, useRef } from 'react'
import { Plus, Trash2, Upload, FileText, ExternalLink, GripVertical, X, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase-browser'

const PIPELINE_STAGES = [
  'New Lead', 'Contacted', 'Qualified', 'Discovery',
  'Proposal', 'Enrolled', 'Active', 'Graduated'
]

interface PipelineResource {
  id: string
  org_id: string
  pipeline_stage: string
  name: string
  description: string | null
  file_url: string | null
  file_type: string | null
  file_size: number | null
  storage_path: string | null
  sort_order: number
  is_active: boolean
}

export default function PipelineResourcesManager({ orgId }: { orgId: string }) {
  const supabase = createClient()
  const [resources, setResources] = useState<PipelineResource[]>([])
  const [loading, setLoading] = useState(true)
  const [activeStage, setActiveStage] = useState('New Lead')
  const [uploading, setUploading] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', description: '', file: null as File | null, url: '' })
  const fileRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('pipeline_resources')
      .select('*')
      .eq('org_id', orgId)
      .order('sort_order')
    if (data) setResources(data)
    setLoading(false)
  }

  useEffect(() => { load() }, [orgId])

  const stageResources = resources.filter(r => r.pipeline_stage === activeStage)

  const handleUpload = async () => {
    if (!addForm.name.trim()) return
    setUploading(true)

    let fileUrl = addForm.url || null
    let storagePath = null
    let fileType = null
    let fileSize = null

    // Upload file to Supabase Storage if provided
    if (addForm.file) {
      const ext = addForm.file.name.split('.').pop()
      const path = `${orgId}/${activeStage.toLowerCase().replace(/\s+/g, '-')}/${Date.now()}-${addForm.file.name}`

      const { data: uploaded, error } = await supabase.storage
        .from('pipeline-resources')
        .upload(path, addForm.file)

      if (error) {
        console.error('Upload error:', error)
        setUploading(false)
        return
      }

      storagePath = uploaded.path
      fileType = addForm.file.type || ext || null
      fileSize = addForm.file.size

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('pipeline-resources')
        .getPublicUrl(path)
      fileUrl = urlData.publicUrl
    }

    const { error } = await supabase.from('pipeline_resources').insert({
      org_id: orgId,
      pipeline_stage: activeStage,
      name: addForm.name.trim(),
      description: addForm.description.trim() || null,
      file_url: fileUrl,
      file_type: fileType,
      file_size: fileSize,
      storage_path: storagePath,
      sort_order: stageResources.length,
    })

    if (!error) {
      setAddForm({ name: '', description: '', file: null, url: '' })
      setShowAdd(false)
      load()
    }
    setUploading(false)
  }

  const handleDelete = async (resource: PipelineResource) => {
    if (!confirm(`Delete "${resource.name}"?`)) return

    // Delete from storage if applicable
    if (resource.storage_path) {
      await supabase.storage.from('pipeline-resources').remove([resource.storage_path])
    }

    await supabase.from('pipeline_resources').delete().eq('id', resource.id)
    load()
  }

  const toggleActive = async (resource: PipelineResource) => {
    await supabase.from('pipeline_resources')
      .update({ is_active: !resource.is_active })
      .eq('id', resource.id)
    load()
  }

  const formatSize = (bytes: number | null) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-bold text-np-dark mb-1">Pipeline Resources</h3>
        <p className="text-[10px] text-gray-400">Upload resources per pipeline stage. These appear in the email composer when emailing contacts in that stage.</p>
      </div>

      {/* Stage Tabs */}
      <div className="flex flex-wrap gap-1">
        {PIPELINE_STAGES.map(stage => {
          const count = resources.filter(r => r.pipeline_stage === stage).length
          return (
            <button key={stage} onClick={() => setActiveStage(stage)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-medium transition-all ${
                activeStage === stage
                  ? 'bg-np-blue text-white shadow-sm'
                  : 'bg-gray-50 text-gray-500 hover:bg-gray-100'
              }`}>
              {stage}
              {count > 0 && <span className={`ml-1 px-1 rounded text-[8px] ${activeStage === stage ? 'bg-white/20' : 'bg-gray-200'}`}>{count}</span>}
            </button>
          )
        })}
      </div>

      {/* Resources List */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-6 text-[10px] text-gray-400">Loading...</div>
        ) : stageResources.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-gray-200 rounded-lg">
            <FileText className="w-6 h-6 text-gray-300 mx-auto mb-2" />
            <p className="text-[10px] text-gray-400">No resources for {activeStage}</p>
            <p className="text-[9px] text-gray-300">Upload files or add links that can be sent to contacts in this stage</p>
          </div>
        ) : stageResources.map(r => (
          <div key={r.id} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-all ${
            r.is_active ? 'bg-white border-gray-100' : 'bg-gray-50/50 border-gray-100 opacity-60'
          }`}>
            <GripVertical className="w-3 h-3 text-gray-300 flex-shrink-0 cursor-grab" />
            <FileText className="w-4 h-4 text-gray-400 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[11px] font-medium text-np-dark truncate">{r.name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                {r.description && <p className="text-[9px] text-gray-400 truncate">{r.description}</p>}
                {r.file_type && <span className="text-[8px] text-gray-300 bg-gray-100 px-1 rounded">{r.file_type.split('/').pop()}</span>}
                {r.file_size && <span className="text-[8px] text-gray-300">{formatSize(r.file_size)}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1">
              {r.file_url && (
                <a href={r.file_url} target="_blank" rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-gray-100">
                  <ExternalLink className="w-3 h-3 text-gray-400" />
                </a>
              )}
              <button onClick={() => toggleActive(r)}
                className={`relative w-7 h-4 rounded-full transition-colors ${r.is_active ? 'bg-green-500' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${r.is_active ? 'left-[14px]' : 'left-0.5'}`} />
              </button>
              <button onClick={() => handleDelete(r)} className="p-1 rounded hover:bg-red-50">
                <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-500" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Resource Form */}
      {showAdd ? (
        <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Add Resource to {activeStage}
            </p>
            <button onClick={() => setShowAdd(false)} className="p-0.5 hover:bg-gray-100 rounded">
              <X className="w-3 h-3 text-gray-400" />
            </button>
          </div>

          <input value={addForm.name} onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))}
            placeholder="Resource name (e.g., Intake Form, Welcome Guide)"
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />

          <input value={addForm.description} onChange={e => setAddForm(p => ({ ...p, description: e.target.value }))}
            placeholder="Description (optional)"
            className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />

          <div className="flex gap-2">
            {/* File Upload */}
            <div className="flex-1">
              <input ref={fileRef} type="file" className="hidden"
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.mp4,.zip"
                onChange={e => setAddForm(p => ({ ...p, file: e.target.files?.[0] || null }))} />
              <button onClick={() => fileRef.current?.click()}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 border border-dashed border-gray-300 rounded-md text-[10px] text-gray-500 hover:border-np-blue hover:text-np-blue transition-colors">
                <Upload className="w-3 h-3" />
                {addForm.file ? addForm.file.name : 'Upload File'}
              </button>
            </div>

            <span className="self-center text-[9px] text-gray-300">or</span>

            {/* URL */}
            <input value={addForm.url} onChange={e => setAddForm(p => ({ ...p, url: e.target.value }))}
              placeholder="External URL"
              className="flex-1 px-2.5 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setShowAdd(false)} className="px-2 py-1 text-[10px] text-gray-400">Cancel</button>
            <button onClick={handleUpload} disabled={!addForm.name.trim() || uploading}
              className="flex items-center gap-1 px-3 py-1.5 bg-np-blue text-white text-[10px] font-medium rounded-md disabled:opacity-40 hover:bg-np-dark transition-colors">
              {uploading ? <><Loader2 className="w-3 h-3 animate-spin" /> Uploading...</> : <><Plus className="w-3 h-3" /> Add Resource</>}
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 w-full border border-dashed border-gray-200 rounded-lg text-[10px] text-gray-400 hover:border-np-blue hover:text-np-blue transition-colors">
          <Plus className="w-3 h-3" /> Add Resource to {activeStage}
        </button>
      )}
    </div>
  )
}
