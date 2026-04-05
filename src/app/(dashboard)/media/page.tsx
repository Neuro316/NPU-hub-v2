'use client'

import { useState, useRef } from 'react'
import { useMediaData } from '@/lib/hooks/use-media-data'
import type { MediaAsset } from '@/lib/hooks/use-media-data'
// Upload handled via /api/media/upload route
import { useWorkspace } from '@/lib/workspace-context'
import { Plus, Search, Grid, List, Upload, Image, Film, FileText, Folder, X, ExternalLink, Trash2, Tag, Eye, Download, Play, Maximize2, MoreVertical, Link2, CheckCircle2, Copy } from 'lucide-react'

const BRAND_OPTIONS = [
  { value: 'all', label: 'All Brands', color: '#6B7280' },
  { value: 'np', label: 'Neuro Progeny', color: '#386797' },
  { value: 'sensorium', label: 'Sensorium', color: '#10B981' },
  { value: 'both', label: 'Shared', color: '#8B5CF6' },
]

const COLLECTION_COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

function getTypeIcon(mime: string | null, size?: 'sm' | 'lg') {
  const cls = size === 'lg' ? 'w-10 h-10' : 'w-5 h-5'
  if (!mime) return <FileText className={cls} />
  if (mime.startsWith('image')) return <Image className={cls} />
  if (mime.startsWith('video')) return <Film className={cls} />
  if (mime.includes('pdf')) return <FileText className={cls} />
  return <FileText className={cls} />
}

function getTypeEmoji(mime: string | null): string {
  if (!mime) return '📎'
  if (mime.startsWith('image')) return '🖼️'
  if (mime.startsWith('video')) return '🎥'
  if (mime.startsWith('audio')) return '🎵'
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('word') || mime.includes('document')) return '📝'
  if (mime.includes('sheet') || mime.includes('excel')) return '📊'
  if (mime.includes('presentation') || mime.includes('powerpoint')) return '📽️'
  if (mime.includes('zip') || mime.includes('rar')) return '📦'
  return '📎'
}

function getTypeColor(mime: string | null): string {
  if (!mime) return '#6B7280'
  if (mime.startsWith('image')) return '#3B82F6'
  if (mime.startsWith('video')) return '#EF4444'
  if (mime.includes('pdf')) return '#DC2626'
  if (mime.includes('word') || mime.includes('document')) return '#2563EB'
  if (mime.includes('sheet') || mime.includes('excel')) return '#16A34A'
  return '#6B7280'
}

function getFileExt(name: string): string {
  return name.split('.').pop()?.toUpperCase() || ''
}

function getEmbedUrl(url: string, mime: string | null): { type: 'image' | 'video' | 'pdf' | 'office' | 'iframe' | 'none'; src: string } {
  if (!url) return { type: 'none', src: '' }

  // Images
  if (mime?.startsWith('image/')) return { type: 'image', src: url }

  // YouTube
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
    if (match) return { type: 'video', src: `https://www.youtube.com/embed/${match[1]}` }
  }

  // Vimeo
  if (url.includes('vimeo.com')) {
    const match = url.match(/vimeo\.com\/(\d+)/)
    if (match) return { type: 'video', src: `https://player.vimeo.com/video/${match[1]}` }
  }

  // HTML5 video
  if (mime?.startsWith('video/')) return { type: 'video', src: url }

  // PDFs
  if (mime?.includes('pdf') || url.toLowerCase().endsWith('.pdf')) {
    return { type: 'pdf', src: url }
  }

  // Office docs — use Microsoft Online Viewer
  const officeExts = ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt']
  if (officeExts.some(ext => url.toLowerCase().endsWith(ext))) {
    return { type: 'office', src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}` }
  }

  // Google Docs/Sheets/Slides
  if (url.includes('docs.google.com') || url.includes('sheets.google.com') || url.includes('slides.google.com')) {
    const embedUrl = url.replace(/\/edit.*$/, '/preview').replace(/\/view.*$/, '/preview')
    return { type: 'iframe', src: embedUrl }
  }

  return { type: 'none', src: '' }
}

function formatSize(bytes: number | null) {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB'
  return (bytes / 1048576).toFixed(1) + ' MB'
}

export default function MediaPage() {
  const { currentOrg, loading: orgLoading } = useWorkspace()
  const { assets, collections, loading, refresh: refreshAssets, addAsset, updateAsset, deleteAsset, addCollection, deleteCollection } = useMediaData()

  const [search, setSearch] = useState('')
  const [brandFilter, setBrandFilter] = useState('all')
  const [collectionFilter, setCollectionFilter] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedAsset, setSelectedAsset] = useState<MediaAsset | null>(null)
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyAssetUrl = (e: React.MouseEvent, asset: MediaAsset) => {
    e.stopPropagation()
    navigator.clipboard.writeText(asset.url)
    setCopiedId(asset.id)
    setMenuOpenId(null)
    setTimeout(() => setCopiedId(null), 1500)
  }
  const [addingUrl, setAddingUrl] = useState(false)
  const [newUrl, setNewUrl] = useState('')
  const [newName, setNewName] = useState('')
  const [newBrand, setNewBrand] = useState<'np' | 'sensorium' | 'both'>('np')
  const [addingCollection, setAddingCollection] = useState(false)
  const [newColName, setNewColName] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filter
  const filtered = assets.filter(a => {
    if (search && !a.name.toLowerCase().includes(search.toLowerCase()) && !a.tags.some(t => t.toLowerCase().includes(search.toLowerCase()))) return false
    if (brandFilter !== 'all' && a.brand !== brandFilter) return false
    if (collectionFilter && a.collection_id !== collectionFilter) return false
    return true
  })

  const handleAddUrl = async () => {
    if (!newUrl.trim() || !newName.trim()) return
    const url = newUrl.trim()
    const isImage = /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url)
    const isVideo = /\.(mp4|mov|webm)$/i.test(url)
    const isYouTube = url.includes('youtube.com') || url.includes('youtu.be')
    const isVimeo = url.includes('vimeo.com')

    // Auto-generate thumbnail for YouTube/Vimeo
    let thumb: string | null = null
    if (isImage) {
      thumb = url
    } else if (isYouTube) {
      const match = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&?/]+)/)
      if (match) thumb = `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg`
    }

    const result = await addAsset({
      name: newName.trim(),
      url,
      thumbnail_url: thumb,
      mime_type: isImage ? 'image/jpeg' : (isVideo || isYouTube || isVimeo) ? 'video/mp4' : 'application/octet-stream',
      brand: newBrand,
      tags: [],
    } as any)

    // For Vimeo and other links, try async thumbnail generation
    if (!thumb && result && (result as any).id) {
      fetch('/api/media/generate-thumbnail', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId: (result as any).id }),
      }).catch(() => {})
    }

    setNewUrl('')
    setNewName('')
    setAddingUrl(false)
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !currentOrg) return
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('org_id', currentOrg.id)
      formData.append('brand', currentOrg.slug || 'np')

      const res = await fetch('/api/media/upload', { method: 'POST', body: formData })
      const result = await res.json()

      if (!res.ok || result.error) {
        alert('Upload failed: ' + (result.error || 'Unknown error'))
      } else {
        refreshAssets()
      }
    } catch (err: any) {
      alert('Upload failed: ' + err.message)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleAddCollection = async () => {
    if (!newColName.trim()) return
    const color = COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length]
    await addCollection(newColName.trim(), color)
    setNewColName('')
    setAddingCollection(false)
  }

  if (orgLoading || loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-pulse text-gray-400">Loading media...</div></div>
  }

  return (
    <div onClick={() => setMenuOpenId(null)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-np-dark">Media Library</h1>
          <p className="text-xs text-gray-400 mt-0.5">{currentOrg?.name} · {assets.length} assets · {collections.length} collections</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
            <Upload className="w-3.5 h-3.5" /> Upload
          </button>
          <button onClick={() => setAddingUrl(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 rounded-lg text-xs font-medium text-np-dark hover:bg-gray-50">
            <Plus className="w-3.5 h-3.5" /> Add URL
          </button>
          <button onClick={() => setAddingCollection(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-np-blue text-white rounded-lg text-xs font-medium hover:bg-np-blue/90">
            <Folder className="w-3.5 h-3.5" /> New Collection
          </button>
        </div>
      </div>
      <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} accept="image/*,video/*,.pdf,.doc,.docx" />

      {/* Add URL Form */}
      {addingUrl && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 max-w-lg">
          <h3 className="text-xs font-semibold text-np-dark mb-3">Add Asset from URL</h3>
          <div className="space-y-2">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Asset name"
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" autoFocus />
            <input value={newUrl} onChange={e => setNewUrl(e.target.value)} placeholder="https://..."
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
            <div className="flex gap-2">
              {(['np', 'sensorium', 'both'] as const).map(b => (
                <button key={b} onClick={() => setNewBrand(b)}
                  className={`text-[10px] font-bold px-2.5 py-1 rounded-lg ${newBrand === b ? 'bg-np-blue text-white' : 'bg-gray-100 text-gray-600'}`}>
                  {b === 'np' ? 'Neuro Progeny' : b === 'sensorium' ? 'Sensorium' : 'Shared'}
                </button>
              ))}
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={handleAddUrl} className="btn-primary text-xs py-1.5 px-4">Add</button>
            <button onClick={() => { setAddingUrl(false); setNewUrl(''); setNewName('') }} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Add Collection */}
      {addingCollection && (
        <div className="mb-4 bg-white border border-gray-200 rounded-xl p-4 max-w-xs">
          <h3 className="text-xs font-semibold text-np-dark mb-2">New Collection</h3>
          <input value={newColName} onChange={e => setNewColName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAddCollection(); if (e.key === 'Escape') setAddingCollection(false) }}
            placeholder="Collection name..." className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300 mb-2" autoFocus />
          <div className="flex gap-2">
            <button onClick={handleAddCollection} className="btn-primary text-xs py-1.5 px-4">Create</button>
            <button onClick={() => setAddingCollection(false)} className="btn-secondary text-xs py-1.5 px-4">Cancel</button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search assets or tags..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
        </div>

        {/* Brand filter */}
        <div className="flex gap-1">
          {BRAND_OPTIONS.map(b => (
            <button key={b.value} onClick={() => setBrandFilter(b.value)}
              className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg transition-colors ${brandFilter === b.value ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
              style={brandFilter === b.value ? { backgroundColor: b.color } : {}}>
              {b.label}
            </button>
          ))}
        </div>

        {/* Collection filter */}
        <div className="flex gap-1">
          <button onClick={() => setCollectionFilter(null)}
            className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg ${!collectionFilter ? 'bg-np-dark text-white' : 'bg-gray-100 text-gray-600'}`}>
            All
          </button>
          {collections.map(c => (
            <div key={c.id} className="relative group flex items-center">
              <button onClick={() => setCollectionFilter(collectionFilter === c.id ? null : c.id)}
                className={`text-[10px] font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${collectionFilter === c.id ? 'text-white' : 'bg-gray-100 text-gray-600'}`}
                style={collectionFilter === c.id ? { backgroundColor: c.color } : {}}>
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                {c.name}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  if (confirm('Delete "' + c.name + '"? Assets will not be deleted.')) {
                    deleteCollection(c.id)
                  }
                }}
                className="absolute -top-1.5 -right-1.5 opacity-0 group-hover:opacity-100 w-4 h-4 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center transition-all z-10"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>
          ))}
        </div>

        {/* View toggle */}
        <div className="flex bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('grid')} className={`p-1.5 rounded ${viewMode === 'grid' ? 'bg-white shadow-sm' : ''}`}>
            <Grid className="w-3.5 h-3.5 text-gray-600" />
          </button>
          <button onClick={() => setViewMode('list')} className={`p-1.5 rounded ${viewMode === 'list' ? 'bg-white shadow-sm' : ''}`}>
            <List className="w-3.5 h-3.5 text-gray-600" />
          </button>
        </div>
      </div>

      {/* Empty State */}
      {assets.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-16 text-center">
          <Image className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-np-dark mb-2">Media Library</h2>
          <p className="text-sm text-gray-500 mb-6 max-w-md mx-auto">
            Upload images, videos, and documents. Organize into collections, tag by brand, and use across social posts and campaigns.
          </p>
          <button onClick={() => fileInputRef.current?.click()} className="btn-primary">Upload First Asset</button>
        </div>
      )}

      {/* Grid View */}
      {viewMode === 'grid' && filtered.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filtered.map(asset => (
            <div key={asset.id} onClick={() => setSelectedAsset(asset)}
              className="bg-white border border-gray-100 rounded-xl overflow-hidden cursor-pointer hover:shadow-md hover:border-gray-200 transition-all group">
              {/* Thumbnail */}
              <div className="aspect-square bg-gray-50 flex items-center justify-center relative overflow-hidden">
                {asset.thumbnail_url || (asset.mime_type?.startsWith('image') && asset.url) ? (
                  <img src={asset.thumbnail_url || asset.url} alt={asset.name}
                    className="w-full h-full object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl">{getTypeEmoji(asset.mime_type)}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded"
                      style={{ backgroundColor: getTypeColor(asset.mime_type) + '20', color: getTypeColor(asset.mime_type) }}>
                      {getFileExt(asset.name) || asset.mime_type?.split('/')[1]?.toUpperCase() || 'FILE'}
                    </span>
                  </div>
                )}
                {/* 3-dot menu */}
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                  <button onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === asset.id ? null : asset.id) }}
                    className="p-1 bg-black/50 hover:bg-black/70 rounded-md transition-colors">
                    <MoreVertical className="w-3.5 h-3.5 text-white" />
                  </button>
                  {menuOpenId === asset.id && (
                    <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50">
                      <button onClick={(e) => copyAssetUrl(e, asset)}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                        <Copy className="w-3.5 h-3.5 text-gray-500" /> Copy Link
                      </button>
                      <a href={asset.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-50 flex items-center gap-2">
                        <ExternalLink className="w-3.5 h-3.5 text-gray-500" /> Open in New Tab
                      </a>
                      <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this asset?')) { deleteAsset(asset.id); setMenuOpenId(null) } }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 text-red-600 flex items-center gap-2">
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  )}
                </div>
                {/* Copied toast */}
                {copiedId === asset.id && (
                  <div className="absolute top-2 left-2 bg-green-500 text-white text-[9px] font-bold px-2 py-1 rounded-md flex items-center gap-1 z-10">
                    <CheckCircle2 className="w-3 h-3" /> Copied!
                  </div>
                )}
                {/* Brand badge */}
                <div className="absolute bottom-2 left-2">
                  <span className="text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/50 text-white">
                    {asset.brand === 'np' ? 'NP' : asset.brand === 'sensorium' ? 'SEN' : 'ALL'}
                  </span>
                </div>
              </div>
              {/* Info */}
              <div className="p-2.5">
                <p className="text-[11px] font-semibold text-np-dark truncate">{asset.name}</p>
                <div className="flex items-center gap-1.5 mt-1">
                  {asset.tags.slice(0, 2).map(t => (
                    <span key={t} className="text-[7px] bg-gray-100 text-gray-500 px-1 py-0.5 rounded">{t}</span>
                  ))}
                  {asset.file_size && <span className="text-[8px] text-gray-400 ml-auto">{formatSize(asset.file_size)}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* List View */}
      {viewMode === 'list' && filtered.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-50">
            {filtered.map(asset => (
              <button key={asset.id} onClick={() => setSelectedAsset(asset)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center overflow-hidden flex-shrink-0">
                  {asset.thumbnail_url || (asset.mime_type?.startsWith('image') && asset.url) ? (
                    <img src={asset.thumbnail_url || asset.url} alt="" className="w-full h-full object-cover"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <span className="text-lg">{getTypeEmoji(asset.mime_type)}</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-np-dark truncate">{asset.name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[8px] font-bold uppercase px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: asset.brand === 'np' ? '#386797' + '20' : asset.brand === 'sensorium' ? '#10B981' + '20' : '#8B5CF6' + '20',
                               color: asset.brand === 'np' ? '#386797' : asset.brand === 'sensorium' ? '#10B981' : '#8B5CF6' }}>
                      {asset.brand === 'np' ? 'Neuro Progeny' : asset.brand === 'sensorium' ? 'Sensorium' : 'Shared'}
                    </span>
                    {asset.tags.slice(0, 3).map(t => (
                      <span key={t} className="text-[8px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">{t}</span>
                    ))}
                  </div>
                </div>
                <div className="text-[9px] text-gray-400 flex-shrink-0 mr-2">
                  {formatSize(asset.file_size)}
                </div>
                {/* Copy link button */}
                <div className="flex-shrink-0" onClick={e => e.stopPropagation()}>
                  {copiedId === asset.id ? (
                    <span className="text-[9px] text-green-600 font-bold flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Copied</span>
                  ) : (
                    <button onClick={(e) => copyAssetUrl(e, asset)}
                      className="p-1.5 text-gray-400 hover:text-np-blue hover:bg-gray-100 rounded transition-colors" title="Copy link">
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Asset Detail Panel */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/20" onClick={() => setSelectedAsset(null)} />
          <div className="relative w-full max-w-md bg-white shadow-xl border-l border-gray-100 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
              <h3 className="text-sm font-bold text-np-dark truncate">{selectedAsset.name}</h3>
              <div className="flex gap-1">
                <button onClick={async () => { await deleteAsset(selectedAsset.id); setSelectedAsset(null) }}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                <button onClick={() => setSelectedAsset(null)} className="p-1.5 rounded hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* Preview */}
              {(() => {
                const embed = getEmbedUrl(selectedAsset.url, selectedAsset.mime_type)
                return (
                  <div className="bg-gray-50 rounded-xl overflow-hidden">
                    {embed.type === 'image' && (
                      <img src={selectedAsset.url} alt={selectedAsset.name} className="w-full" />
                    )}
                    {embed.type === 'video' && (
                      selectedAsset.mime_type?.startsWith('video/') && !embed.src.includes('youtube') && !embed.src.includes('vimeo') ? (
                        <video src={embed.src} controls className="w-full" preload="metadata" />
                      ) : (
                        <div className="aspect-video">
                          <iframe src={embed.src} className="w-full h-full border-0" allowFullScreen
                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" />
                        </div>
                      )
                    )}
                    {embed.type === 'pdf' && (
                      <div className="aspect-[3/4]">
                        <iframe src={embed.src} className="w-full h-full border-0" />
                      </div>
                    )}
                    {embed.type === 'office' && (
                      <div className="aspect-[3/4]">
                        <iframe src={embed.src} className="w-full h-full border-0" />
                      </div>
                    )}
                    {embed.type === 'iframe' && (
                      <div className="aspect-video">
                        <iframe src={embed.src} className="w-full h-full border-0" allowFullScreen />
                      </div>
                    )}
                    {embed.type === 'none' && (
                      <div className="flex flex-col items-center justify-center py-12 gap-3">
                        <span className="text-4xl">{getTypeEmoji(selectedAsset.mime_type)}</span>
                        <span className="text-xs font-bold uppercase tracking-wider px-3 py-1 rounded"
                          style={{ backgroundColor: getTypeColor(selectedAsset.mime_type) + '20', color: getTypeColor(selectedAsset.mime_type) }}>
                          {getFileExt(selectedAsset.name) || 'FILE'}
                        </span>
                        <p className="text-xs text-gray-400">Preview not available</p>
                        {selectedAsset.url && (
                          <a href={selectedAsset.url} target="_blank" rel="noopener"
                            className="flex items-center gap-1.5 text-xs text-np-blue hover:underline mt-1">
                            <Download className="w-3.5 h-3.5" /> Download to view
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
              {/* Fields */}
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Name</label>
                  <input value={selectedAsset.name}
                    onChange={e => { const v = e.target.value; setSelectedAsset(prev => prev ? { ...prev, name: v } : null) }}
                    onBlur={() => updateAsset(selectedAsset.id, { name: selectedAsset.name })}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Brand</label>
                  <div className="flex gap-1.5">
                    {(['np', 'sensorium', 'both'] as const).map(b => (
                      <button key={b} onClick={() => { updateAsset(selectedAsset.id, { brand: b }); setSelectedAsset(prev => prev ? { ...prev, brand: b } : null) }}
                        className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border-2 ${selectedAsset.brand === b ? 'border-np-blue bg-np-blue/10 text-np-blue' : 'border-transparent bg-gray-100 text-gray-500'}`}>
                        {b === 'np' ? 'Neuro Progeny' : b === 'sensorium' ? 'Sensorium' : 'Shared'}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-1">Collection</label>
                  <select value={selectedAsset.collection_id || ''}
                    onChange={e => { const v = e.target.value || null; updateAsset(selectedAsset.id, { collection_id: v } as any); setSelectedAsset(prev => prev ? { ...prev, collection_id: v } : null) }}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-np-blue/30">
                    <option value="">No Collection</option>
                    {collections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider flex items-center gap-1 mb-1"><Tag className="w-3 h-3" /> Tags</label>
                  <div className="flex flex-wrap gap-1 mb-1.5">
                    {selectedAsset.tags.map((t, i) => (
                      <span key={i} className="text-[9px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                        {t}
                        <button onClick={() => {
                          const newTags = selectedAsset.tags.filter((_, idx) => idx !== i)
                          updateAsset(selectedAsset.id, { tags: newTags } as any)
                          setSelectedAsset(prev => prev ? { ...prev, tags: newTags } : null)
                        }} className="text-gray-400 hover:text-red-500"><X className="w-2.5 h-2.5" /></button>
                      </span>
                    ))}
                  </div>
                  <input placeholder="Add tag and press Enter"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                        const newTag = (e.target as HTMLInputElement).value.trim()
                        const newTags = [...selectedAsset.tags, newTag]
                        updateAsset(selectedAsset.id, { tags: newTags } as any)
                        setSelectedAsset(prev => prev ? { ...prev, tags: newTags } : null);
                        (e.target as HTMLInputElement).value = ''
                      }
                    }}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-np-blue/30 placeholder-gray-300" />
                </div>
                {selectedAsset.url && (
                  <div className="flex items-center gap-3">
                    <button onClick={() => { navigator.clipboard.writeText(selectedAsset.url); setCopiedId(selectedAsset.id); setTimeout(() => setCopiedId(null), 1500) }}
                      className="flex items-center gap-1 text-xs text-np-blue hover:underline">
                      {copiedId === selectedAsset.id ? <><CheckCircle2 className="w-3 h-3 text-green-500" /> Copied!</> : <><Copy className="w-3 h-3" /> Copy embed link</>}
                    </button>
                    <a href={selectedAsset.url} target="_blank" rel="noopener"
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-np-blue hover:underline">
                      <ExternalLink className="w-3 h-3" /> Open original
                    </a>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 text-[9px] text-gray-400">
                  {selectedAsset.width && selectedAsset.height && <div><span className="font-medium text-gray-500">Size:</span> {selectedAsset.width}×{selectedAsset.height}</div>}
                  {selectedAsset.file_size && <div><span className="font-medium text-gray-500">File:</span> {formatSize(selectedAsset.file_size)}</div>}
                  <div><span className="font-medium text-gray-500">Used:</span> {selectedAsset.usage_count}×</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
