'use client'

import { useState, useRef } from 'react'
import { Upload, Download, Trash2, FileText } from 'lucide-react'
import type { TaskAttachment } from '@/lib/types/tasks'
import { formatFileSize, getFileIcon } from '@/lib/types/tasks'

interface Props {
  taskId: string
  attachments: TaskAttachment[]
  onUpload: (files: FileList) => Promise<void>
  onDelete: (attachmentId: string) => Promise<void>
  onDownload: (attachment: TaskAttachment) => Promise<void>
}

export function TaskAttachments({ taskId, attachments, onUpload, onDelete, onDownload }: Props) {
  const [uploading, setUploading] = useState(false)
  const [dragActive, setDragActive] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    if (e.dataTransfer.files?.length) {
      setUploading(true)
      await onUpload(e.dataTransfer.files)
      setUploading(false)
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setUploading(true)
      await onUpload(e.target.files)
      setUploading(false)
      e.target.value = ''
    }
  }

  return (
    <div>
      <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <FileText className="w-3.5 h-3.5" /> Attachments ({attachments.length})
      </h3>

      {/* Upload area */}
      <div onDragEnter={handleDrag} onDragLeave={handleDrag} onDragOver={handleDrag} onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`mb-2 border-2 border-dashed rounded-lg p-3 text-center cursor-pointer transition-all ${
          dragActive ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-blue-300 hover:bg-gray-50'
        }`}>
        <input ref={fileInputRef} type="file" multiple onChange={handleFileSelect} className="hidden" />
        {uploading ? (
          <div className="flex items-center justify-center gap-2 py-1">
            <div className="w-4 h-4 border-2 border-blue-600/30 border-t-blue-600 rounded-full animate-spin" />
            <span className="text-xs text-gray-600">Uploading...</span>
          </div>
        ) : (
          <div className="py-1">
            <Upload className="w-5 h-5 text-gray-400 mx-auto mb-1" />
            <p className="text-[10px] font-medium text-gray-500">Click or drag files (max 50MB)</p>
          </div>
        )}
      </div>

      {/* File list */}
      {attachments.length > 0 && (
        <div className="space-y-1">
          {attachments.map(a => (
            <div key={a.id} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors group">
              <span className="text-lg flex-shrink-0">{getFileIcon(a.file_type)}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-np-dark truncate">{a.file_name}</p>
                <p className="text-[9px] text-gray-400">{formatFileSize(a.file_size)} · {a.uploaded_by_name || 'Unknown'} · {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </div>
              <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={(e) => { e.stopPropagation(); onDownload(a) }} className="p-1.5 text-gray-500 hover:text-blue-600 rounded" title="Download">
                  <Download className="w-3.5 h-3.5" />
                </button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(a.id) }} className="p-1.5 text-gray-500 hover:text-red-600 rounded" title="Delete">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
