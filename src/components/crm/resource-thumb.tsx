'use client'

// A Resource Library file's thumbnail (Resources page and the Send resources panel): the
// stored WebP of a PDF's first page or an image, lazy-loaded, in a fixed 3:4 frame with a
// subtle border. Without a thumbnail, or if it fails to load, a file-type tile (DOCX, PDF,
// PNG...) in the Hub's colours. `generating` shows the brief "Generating preview" state
// after an upload or Replace file. With onClick it is a button that opens the preview.
import { useEffect, useState } from 'react'
import { FileText, Image as ImageIcon, Loader2 } from 'lucide-react'
import { tileLabel, thumbKind } from '@/lib/resources/thumbs'

const TILE_COLORS: Record<string, string> = {
  PDF: '#c2410c', DOCX: '#2b579a', DOC: '#2b579a', PPTX: '#c43e1c', PPT: '#c43e1c', XLSX: '#217346',
}

const SIZES = {
  md: { box: 'w-12 sm:w-16', icon: 18, label: 'text-[9px]', note: 'text-[8px]' },
  sm: { box: 'w-7', icon: 11, label: 'text-[6px]', note: '' },
} as const

export function ResourceThumb({ url, mime, fileName, name, size = 'md', generating = false, onClick }: {
  url: string | null | undefined
  mime: string
  fileName?: string
  /** The resource's name, for the alt text and the preview button's label. */
  name: string
  size?: keyof typeof SIZES
  generating?: boolean
  onClick?: () => void
}) {
  const [failed, setFailed] = useState(false)
  useEffect(() => { setFailed(false) }, [url])
  const s = SIZES[size]
  const label = tileLabel(mime, fileName)
  const showImage = !!url && !failed

  const inner = (
    <span className={`relative block ${s.box} aspect-[3/4] overflow-hidden rounded-md border border-gray-200 bg-white`}>
      {showImage ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url!} alt={`Preview of ${name}`} loading="lazy" decoding="async" onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top" />
      ) : (
        <span className="flex h-full w-full flex-col items-center justify-center gap-0.5 bg-gray-50 text-gray-400">
          {thumbKind(mime) === 'image' ? <ImageIcon size={s.icon} /> : <FileText size={s.icon} />}
          <span className={`rounded px-1 font-bold leading-tight text-white ${s.label}`} style={{ background: TILE_COLORS[label] ?? '#2a5a8c' }}>
            {label}
          </span>
        </span>
      )}
      {generating && (
        <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 bg-white/80 text-np-blue" title="Generating preview">
          <Loader2 size={s.icon - 4} className="animate-spin" />
          {s.note && <span className={`${s.note} font-medium leading-tight text-center px-0.5`}>Generating preview</span>}
        </span>
      )}
    </span>
  )

  if (!onClick) return inner
  return (
    <button type="button" onClick={onClick} aria-label={`Preview ${name}`} title="Preview"
      className="flex-shrink-0 rounded-md hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-np-blue/40">
      {inner}
    </button>
  )
}
