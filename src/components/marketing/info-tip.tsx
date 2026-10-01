'use client'
// A small (i) button that opens a short explanation. Keyboard and screen reader
// accessible: a real button with aria-expanded and aria-controls, the panel is a
// labelled, non-modal dialog that takes focus, and Escape or a click outside closes it
// and returns focus to the button.
import { useEffect, useId, useRef, useState } from 'react'
import { Info, X } from 'lucide-react'

export function InfoTip({ topic, children, wide = false }: { topic: string; children: React.ReactNode; wide?: boolean }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    panel.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus() } }
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('mousedown', onDown)
    return () => { document.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown) }
  }, [open])

  return (
    <span className="relative inline-flex align-middle">
      <button ref={btn} type="button" aria-label={`About ${topic}`} aria-expanded={open} aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 rounded-full p-0.5 text-gray-400 hover:text-np-blue focus:outline-none focus:ring-2 focus:ring-np-blue/40">
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <div ref={panel} id={id} role="dialog" aria-label={`About ${topic}`} tabIndex={-1}
          className={`absolute left-0 top-6 z-[60] ${wide ? 'w-[min(88vw,420px)]' : 'w-[min(80vw,280px)]'} rounded-xl border border-gray-100 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-card-hover focus:outline-none`}>
          <div className="flex items-start gap-2">
            <div className="flex-1 space-y-1.5">{children}</div>
            <button type="button" aria-label="Close" onClick={() => { setOpen(false); btn.current?.focus() }} className="rounded p-0.5 text-gray-400 hover:text-np-dark">
              <X className="h-3 w-3" aria-hidden />
            </button>
          </div>
        </div>
      )}
    </span>
  )
}
