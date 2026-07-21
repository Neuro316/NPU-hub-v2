'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, Upload, Trash2, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react'
import { useWorkspace } from '@/lib/workspace-context'
import { blobToTwilioWav, canRecordInBrowser } from '@/lib/audio-wav'

// Voicemail greeting panel (CRM Settings -> Twilio / SMS).
// Two ways in: upload an mp3/wav, or record in-browser. Both converge on a
// format Twilio's <Play> can render — recordings are transcoded to WAV client
// side because MediaRecorder's native WebM/Opus is unplayable by Twilio.
// All writes go through /api/comms/greeting, which is admin-gated server-side.

const MAX_MB = 5
const MAX_SECONDS = 120

export default function VoicemailGreeting() {
  const { currentOrg } = useWorkspace()

  const [loading, setLoading] = useState(true)
  const [greetingUrl, setGreetingUrl] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [filename, setFilename] = useState<string | null>(null)

  const [busy, setBusy] = useState<'' | 'saving' | 'removing' | 'processing'>('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const [recording, setRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [pending, setPending] = useState<{ blob: Blob; url: string } | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<BlobPart[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const recordSupported = canRecordInBrowser()

  const load = useCallback(async () => {
    if (!currentOrg) return
    setLoading(true)
    try {
      const res = await fetch(`/api/comms/greeting?org_id=${encodeURIComponent(currentOrg.id)}`)
      const data = await res.json()
      if (res.ok) {
        setGreetingUrl(data.greeting_url || null)
        setUpdatedAt(data.greeting_updated_at || null)
        setFilename(data.greeting_filename || null)
      }
    } catch {
      /* non-fatal: the panel just shows "no greeting" */
    } finally {
      setLoading(false)
    }
  }, [currentOrg])

  useEffect(() => { load() }, [load])

  // Release the object URL + any live mic track on unmount.
  useEffect(() => () => {
    if (pending) URL.revokeObjectURL(pending.url)
    if (timerRef.current) clearInterval(timerRef.current)
    recorderRef.current?.stream.getTracks().forEach(t => t.stop())
  }, [pending])

  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 2500) }

  const upload = async (blob: Blob, name: string) => {
    if (!currentOrg) return
    setBusy('saving'); setError('')
    try {
      const form = new FormData()
      form.append('file', blob, name)
      form.append('org_id', currentOrg.id)
      const res = await fetch('/api/comms/greeting', { method: 'POST', body: form })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Upload failed')
      clearPending()
      await load()
      flash()
    } catch (e: any) {
      setError(e?.message || 'Upload failed')
    } finally {
      setBusy('')
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''  // allow re-picking the same file
    if (!file) return
    setError('')
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. Maximum is ${MAX_MB} MB.`)
      return
    }
    await upload(file, file.name)
  }

  const startRecording = async () => {
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = ev => { if (ev.data.size) chunksRef.current.push(ev.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        setRecording(false)
        setBusy('processing')
        try {
          // Transcode BEFORE preview so what you hear is exactly what uploads —
          // and exactly what Twilio will play.
          const wav = await blobToTwilioWav(new Blob(chunksRef.current, { type: recorder.mimeType }))
          setPending({ blob: wav, url: URL.createObjectURL(wav) })
        } catch (e: any) {
          setError(e?.message || 'Could not process that recording.')
        } finally {
          setBusy('')
        }
      }
      recorderRef.current = recorder
      recorder.start()
      setRecording(true)
      setElapsed(0)
      timerRef.current = setInterval(() => {
        setElapsed(prev => {
          const next = prev + 1
          if (next >= MAX_SECONDS) stopRecording()
          return next
        })
      }, 1000)
    } catch {
      setError('Microphone access was blocked. Allow the mic for this site, then try again.')
    }
  }

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
  }

  const clearPending = () => {
    setPending(prev => { if (prev) URL.revokeObjectURL(prev.url); return null })
    setElapsed(0)
  }

  const remove = async () => {
    if (!currentOrg) return
    setBusy('removing'); setError('')
    try {
      const res = await fetch(`/api/comms/greeting?org_id=${encodeURIComponent(currentOrg.id)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error || 'Could not remove the greeting')
      setGreetingUrl(null); setUpdatedAt(null); setFilename(null)
      flash()
    } catch (e: any) {
      setError(e?.message || 'Could not remove the greeting')
    } finally {
      setBusy('')
    }
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div className="border-t border-gray-100 pt-4">
      <h4 className="text-xs font-semibold text-np-dark mb-1">Voicemail Greeting</h4>
      <p className="text-[10px] text-gray-400 mb-3">
        What callers hear before the beep. Upload an MP3 or WAV, or record one here. With no greeting
        set, callers hear the default &ldquo;Please leave a message after the tone.&rdquo;
      </p>

      {/* Current greeting */}
      <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-3 mb-3">
        {loading ? (
          <p className="text-[10px] text-gray-400">Loading…</p>
        ) : greetingUrl ? (
          <>
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Current greeting</p>
                <p className="text-[10px] text-gray-500 truncate">
                  {filename || 'greeting'}
                  {updatedAt && ` · updated ${new Date(updatedAt).toLocaleDateString()}`}
                </p>
              </div>
              <button
                onClick={remove}
                disabled={!!busy}
                className="flex items-center gap-1 px-2 py-1 text-[10px] text-gray-400 hover:text-red-500 disabled:opacity-40"
              >
                <Trash2 size={11} /> {busy === 'removing' ? 'Removing…' : 'Remove'}
              </button>
            </div>
            {/* Hear exactly what callers hear before replacing it. */}
            <audio controls src={greetingUrl} className="w-full h-8" />
          </>
        ) : (
          <p className="text-[10px] text-gray-500">
            No custom greeting — callers hear the default message.
          </p>
        )}
      </div>

      {/* Record */}
      <div className="flex flex-wrap items-center gap-2">
        {recordSupported ? (
          recording ? (
            <button
              onClick={stopRecording}
              className="flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white text-xs font-medium rounded-lg hover:bg-red-600"
            >
              <Square size={12} /> Stop · {mmss(elapsed)}
            </button>
          ) : (
            <button
              onClick={startRecording}
              disabled={!!busy || !currentOrg}
              className="flex items-center gap-1.5 px-3 py-2 border border-np-blue/20 text-np-blue text-xs font-medium rounded-lg hover:bg-np-blue/5 disabled:opacity-40"
            >
              <Mic size={12} /> Record greeting
            </button>
          )
        ) : (
          <span className="text-[10px] text-gray-400">
            In-browser recording isn&rsquo;t supported here — upload a file instead.
          </span>
        )}

        {/* Upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={!!busy || recording || !currentOrg}
          className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-np-dark text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-40"
        >
          <Upload size={12} /> Upload MP3 / WAV
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp3,.wav,audio/mpeg,audio/wav,audio/x-wav"
          onChange={onPickFile}
          className="hidden"
        />

        {busy === 'saving' && (
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Loader2 size={11} className="animate-spin" /> Saving…
          </span>
        )}
        {busy === 'processing' && (
          <span className="flex items-center gap-1 text-[10px] text-gray-400">
            <Loader2 size={11} className="animate-spin" /> Converting…
          </span>
        )}
        {saved && (
          <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
            <CheckCircle2 size={12} /> Saved
          </span>
        )}
      </div>

      {/* Review-before-save for a fresh recording */}
      {pending && (
        <div className="mt-3 rounded-lg border border-np-blue/20 bg-np-blue/5 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-np-blue mb-2">
            New recording — listen before saving
          </p>
          <audio controls src={pending.url} className="w-full h-8 mb-2" />
          <div className="flex items-center gap-2">
            <button
              onClick={() => upload(pending.blob, `greeting-${Date.now()}.wav`)}
              disabled={!!busy}
              className="px-3 py-1.5 bg-np-blue text-white text-xs font-medium rounded-lg hover:bg-np-dark disabled:opacity-40"
            >
              {busy === 'saving' ? 'Saving…' : 'Save as greeting'}
            </button>
            <button
              onClick={clearPending}
              disabled={!!busy}
              className="px-3 py-1.5 text-xs text-gray-500 hover:text-np-dark disabled:opacity-40"
            >
              Discard
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <AlertTriangle size={12} className="text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-red-700">{error}</p>
        </div>
      )}

      <p className="text-[9px] text-gray-400 mt-2">
        Max {MAX_MB} MB · up to {MAX_SECONDS / 60} minutes · MP3 or WAV only (the formats Twilio can play).
        Recordings made here are converted to WAV automatically.
      </p>
    </div>
  )
}
