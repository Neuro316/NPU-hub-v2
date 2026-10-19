'use client'

// Browser audio plumbing shared by every Twilio Device in the Hub (the inbound
// receiver in voice-receiver-context.tsx, the /crm/dialer page, and VoipCall).
//
// WHY THIS EXISTS. Desktop Chrome lets a frequently used site play audio and
// run an AudioContext without a fresh tap (its Media Engagement score), which
// hid every one of these problems on the desktop. Phones do not:
//
//   * The SDK keeps ONE static AudioContext for every Device on the page. The
//     receiver Device is created on page load, with no tap, so on iOS Safari
//     and Android Chrome that context starts 'suspended' and nothing in the SDK
//     ever resumes it. The SDK routes the remote stream through it (volume
//     polling everywhere, and the output path where setSinkId exists). Only
//     resume() called inside a user gesture wakes it, so every tap in the app
//     now does that (unlockCallAudio).
//   * The SDK plays the far side through an <audio> element it creates after
//     the call connects, outside any gesture. If the browser refuses that
//     play(), the call is connected and silent. keepRemoteAudioPlaying()
//     retries it, and retries again on the next tap.
//   * iOS Safari has no setSinkId, so output device selection is unsupported
//     there. Calling it anyway rejects. Nothing here calls it unless the SDK
//     reports support, and every call is wrapped so a failure never touches
//     the audio that is already playing.

import { MIC_BLOCKED_MESSAGE, isMicrophoneError } from '@/lib/voice-call-state'

let sdk: any = null

/** Load the Twilio Voice SDK once and remember it, so later code can reach it
 *  synchronously inside a tap handler. */
export async function loadVoiceSdk(): Promise<any> {
  if (!sdk) sdk = await import('@twilio/voice-sdk')
  return sdk
}

/** The SDK if loadVoiceSdk() has finished, for use inside a tap handler. */
export function loadedVoiceSdk(): any {
  if (!sdk) throw new Error('Voice SDK not loaded yet.')
  return sdk
}

function sdkAudioContext(): AudioContext | null {
  try {
    const Device = sdk?.Device
    if (!Device) return null
    // Create the SDK's shared context now, inside the tap, if no Device has yet:
    // a context born in a gesture starts 'running'. Private static, so guarded.
    if (!Device.audioContext && typeof Device._getOrCreateAudioContext === 'function') {
      Device._getOrCreateAudioContext()
    }
    return (Device.audioContext as AudioContext | undefined) ?? null
  } catch { return null }
}

/**
 * Wake the SDK's shared AudioContext. Must run synchronously inside a user
 * gesture to work on iOS Safari. Safe to call any number of times.
 */
export function unlockCallAudio(): void {
  const ctx = sdkAudioContext()
  if (ctx && ctx.state !== 'running') {
    try { ctx.resume().catch(() => { /* next tap tries again */ }) } catch { /* */ }
  }
}

/** The <audio> element(s) the SDK plays the far side through. Internal SDK
 *  fields, read defensively: if a future SDK renames them we get [] and fall
 *  back to the public getRemoteStream(). */
function sdkRemoteAudioElements(call: any): HTMLAudioElement[] {
  const out: HTMLAudioElement[] = []
  try {
    const mh = call?._mediaHandler
    if (mh?._masterAudio) out.push(mh._masterAudio)
    mh?.outputs?.forEach?.((o: any) => { if (o?.audio && !out.includes(o.audio)) out.push(o.audio) })
  } catch { /* sdk internals changed */ }
  return out
}

const keeping = new WeakMap<object, () => void>()

/**
 * Make sure the far side is audible once a call connects, on any browser.
 * Returns a cleanup function; it also cleans up when the call ends.
 */
export function keepRemoteAudioPlaying(call: any): () => void {
  // Runs from 'ringing' (early media: the network's ringback) and again from
  // 'accept'. One keeper per call, so the second call only nudges playback.
  const existing = call && typeof call === 'object' ? keeping.get(call) : undefined
  if (existing) { tryPlayFor(call); return existing }
  let fallback: HTMLAudioElement | null = null
  let stopped = false

  const tryPlay = () => {
    if (stopped) return
    unlockCallAudio()
    const els = sdkRemoteAudioElements(call)
    if (els.length > 0) {
      for (const el of els) {
        try {
          el.muted = false
          if (el.volume === 0) el.volume = 1
          if (el.paused) el.play().catch(() => { /* retried on the next tap */ })
        } catch { /* */ }
      }
      return
    }
    // Could not find the SDK's element: play the remote stream ourselves.
    try {
      const stream: MediaStream | undefined = call?.getRemoteStream?.()
      if (!stream) return
      if (!fallback) {
        fallback = document.createElement('audio')
        fallback.autoplay = true
        fallback.setAttribute('playsinline', '')
        fallback.style.display = 'none'
        document.body.appendChild(fallback)
      }
      if (fallback.srcObject !== stream) fallback.srcObject = stream
      if (fallback.paused) fallback.play().catch(() => { /* retried on the next tap */ })
    } catch { /* */ }
  }

  const onGesture = () => tryPlay()
  const cleanup = () => {
    if (stopped) return
    stopped = true
    if (call && typeof call === 'object') keeping.delete(call)
    players.delete(call)
    document.removeEventListener('pointerdown', onGesture, true)
    document.removeEventListener('touchend', onGesture, true)
    if (fallback) {
      try { fallback.pause(); fallback.srcObject = null; fallback.remove() } catch { /* */ }
      fallback = null
    }
  }

  if (call && typeof call === 'object') { keeping.set(call, cleanup); players.set(call, tryPlay) }
  document.addEventListener('pointerdown', onGesture, true)
  document.addEventListener('touchend', onGesture, true)
  // The SDK attaches its element as the track arrives, just around 'accept'.
  tryPlay()
  setTimeout(tryPlay, 300)
  setTimeout(tryPlay, 1500)
  try {
    call?.once?.('disconnect', cleanup)
    call?.once?.('cancel', cleanup)
    call?.once?.('reject', cleanup)
  } catch { /* */ }
  return cleanup
}

const players = new WeakMap<object, () => void>()
function tryPlayFor(call: any) {
  const p = players.get(call)
  if (!p) return
  p()
  setTimeout(p, 300)
  setTimeout(p, 1500)
}

// ── Ringback ────────────────────────────────────────────────────────────────
//
// What the caller hears while the far phone rings. The network's own ringback
// arrives as early media once the outbound <Dial> has answerOnBridge; this
// local tone covers the gap before that, and any path that sends none.
// Web Audio, because a phone only lets a page start sound inside a tap and the
// tone has to start after the token fetch: the context is created or resumed
// in the tap (primeCallTones) and is still running when the tone starts.

let toneCtx: AudioContext | null = null

/** Create or wake the tone context. Call synchronously inside a user gesture. */
export function primeCallTones(): void {
  try {
    if (!toneCtx) {
      const AC: typeof AudioContext | undefined =
        typeof window === 'undefined' ? undefined : (window.AudioContext || (window as any).webkitAudioContext)
      if (!AC) return
      toneCtx = new AC()
    }
    if (toneCtx.state !== 'running') toneCtx.resume().catch(() => { /* next tap tries again */ })
  } catch { /* no Web Audio: silent ringback */ }
}

/** US ringback: 440 Hz + 480 Hz, 2 seconds on, 4 seconds off. */
export function createRingback(): { start(): void; stop(): void } {
  let nodes: { oscs: OscillatorNode[]; gain: GainNode } | null = null
  let timer: ReturnType<typeof setInterval> | null = null

  const burst = () => {
    if (!toneCtx || !nodes) return
    const t = toneCtx.currentTime
    const g = nodes.gain.gain
    try {
      g.cancelScheduledValues(t)
      g.setValueAtTime(0, t)
      g.linearRampToValueAtTime(0.08, t + 0.02)
      g.setValueAtTime(0.08, t + 2)
      g.linearRampToValueAtTime(0, t + 2.02)
    } catch { /* */ }
  }

  const stop = () => {
    if (timer) { clearInterval(timer); timer = null }
    if (!nodes) return
    const n = nodes
    nodes = null
    try { n.gain.gain.cancelScheduledValues(0); n.gain.gain.value = 0 } catch { /* */ }
    for (const o of n.oscs) { try { o.stop(); o.disconnect() } catch { /* */ } }
    try { n.gain.disconnect() } catch { /* */ }
  }

  return {
    start() {
      if (nodes) return
      primeCallTones()
      const ctx = toneCtx
      if (!ctx) return
      try {
        const gain = ctx.createGain()
        gain.gain.value = 0
        gain.connect(ctx.destination)
        const oscs = [440, 480].map(f => {
          const o = ctx.createOscillator()
          o.frequency.value = f
          o.connect(gain)
          o.start()
          return o
        })
        nodes = { oscs, gain }
        burst()
        timer = setInterval(burst, 6000)
      } catch { stop() }
    },
    stop,
  }
}

/** Server backstop for End: ends the call by its call_logs row. */
export function hangupOnServer(callLogId: string): void {
  try {
    fetch('/api/voice/hangup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_log_id: callLogId }),
      keepalive: true,
    }).catch(() => { /* the client hangup already went out */ })
  } catch { /* */ }
}

export type MicResult = { ok: true } | { ok: false; message: string }

/**
 * Ask for the microphone if it has not been granted yet. Call it first thing
 * in a tap handler so the browser shows its prompt for that tap. The stream is
 * released at once; the grant is what matters.
 */
export async function ensureMicrophone(): Promise<MicResult> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { ok: false, message: 'This browser cannot make calls. Use Safari on iPhone or Chrome on Android or desktop.' }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach(t => t.stop())
    return { ok: true }
  } catch (e: any) {
    if (isMicrophoneError(e)) return { ok: false, message: MIC_BLOCKED_MESSAGE }
    return { ok: false, message: e?.message || 'Could not access the microphone.' }
  }
}

export interface OutputDevice { id: string; label: string }

/** True only when this browser can route call audio to a chosen output. */
export function canSelectOutput(device: any): boolean {
  try { return !!device?.audio?.isOutputSelectionSupported } catch { return false }
}

export function listOutputDevices(device: any): OutputDevice[] {
  if (!canSelectOutput(device)) return []
  try {
    const out: OutputDevice[] = []
    device.audio.availableOutputDevices.forEach((d: MediaDeviceInfo, id: string) => {
      out.push({ id, label: d?.label || (id === 'default' ? 'Default' : 'Speaker') })
    })
    return out
  } catch { return [] }
}

/**
 * Route call audio to one output. Skipped where unsupported (iOS Safari), and
 * a rejection is logged and swallowed: the current output keeps playing.
 */
export async function setOutputDevice(device: any, id: string): Promise<boolean> {
  if (!canSelectOutput(device)) return false
  try {
    await device.audio.speakerDevices.set(id)
    return true
  } catch (e) {
    console.warn('[voice-audio] output selection failed; keeping current output:', e)
    return false
  }
}
