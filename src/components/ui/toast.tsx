'use client'
// src/components/ui/toast.tsx
// A minimal accessible toast. The Hub had none. Success and info messages are
// announced politely (role="status"); errors are announced at once (role="alert").
// Each toast stays until dismissed or for 6 seconds, and can be dismissed by keyboard.
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { X, CheckCircle2, AlertCircle, Info } from 'lucide-react'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; text: string }
interface ToastApi { show: (text: string, kind?: Kind) => void }

const Ctx = createContext<ToastApi>({ show: () => {} })
export const useToast = () => useContext(Ctx)

const STYLE: Record<Kind, { box: string; Icon: typeof Info }> = {
  success: { box: 'border-teal/30 bg-teal-light text-teal-dark', Icon: CheckCircle2 },
  error: { box: 'border-fire/30 bg-fire-light text-fire-warm', Icon: AlertCircle },
  info: { box: 'border-np-blue/20 bg-np-blue-light text-np-blue-dark', Icon: Info },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const seq = useRef(0)
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const show = useCallback((text: string, kind: Kind = 'success') => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => dismiss(id), 6000)
  }, [dismiss])
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[1100] flex w-[min(92vw,360px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => {
          const { box, Icon } = STYLE[t.kind]
          return (
            <div key={t.id} role={t.kind === 'error' ? 'alert' : 'status'}
              className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-card ${box}`}>
              <Icon className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden />
              <span className="flex-1">{t.text}</span>
              <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss message"
                className="rounded p-0.5 opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-np-blue/40">
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}
