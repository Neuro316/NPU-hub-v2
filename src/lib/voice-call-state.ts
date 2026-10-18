// Pure call-list and ringer logic for the browser softphone. No React, no
// Twilio, no DOM globals, so scripts/tests/voice-call-state.test.ts can run it
// under plain `node --test`.
//
// THE RULE THIS FILE EXISTS TO ENFORCE: a ringing call stops ringing ONLY when
// it is answered, declined, or ended by the far side (cancel / disconnect /
// reject / error). A tap, a focus change, a route change, or any other UI event
// is not a call event and cannot reach this reducer, so it cannot silence the
// ringer or remove the call.

export type CallPhase = 'ringing' | 'connected'

export interface CallEntryBase {
  id: string
  phase: CallPhase
  connectedAt: number | null
  muted: boolean
}

export type CallEvent<T extends CallEntryBase> =
  | { type: 'incoming'; entry: T }
  /** Our Answer button (optimistic) or the SDK's 'accept' event. */
  | { type: 'accepted'; id: string; at: number }
  | { type: 'muted'; id: string; muted: boolean }
  /** Decline, hang up, caller cancel, call ended, rejected, call error. */
  | { type: 'ended'; id: string }
  /** Every call is gone (device torn down: disable, org switch, sign-out). */
  | { type: 'cleared' }

export function applyCallEvent<T extends CallEntryBase>(calls: T[], ev: CallEvent<T>): T[] {
  switch (ev.type) {
    case 'incoming':
      // Newest first. An existing ringing call is never replaced or dropped
      // because another arrived; it simply moves down the list.
      return [ev.entry, ...calls.filter(c => c.id !== ev.entry.id)]
    case 'accepted':
      return calls.map(c => (c.id === ev.id && c.phase !== 'connected'
        ? { ...c, phase: 'connected', connectedAt: ev.at } : c))
    case 'muted':
      return calls.map(c => (c.id === ev.id ? { ...c, muted: ev.muted } : c))
    case 'ended':
      return calls.filter(c => c.id !== ev.id)
    case 'cleared':
      return []
  }
}

/**
 * Should the ringtone be audible? Yes while any call is ringing, unless a call
 * is already connected: like the Twilio SDK's own ringer, a second call during
 * a live one shows and queues silently instead of ringing into your ear.
 */
export function shouldRing(calls: ReadonlyArray<Pick<CallEntryBase, 'phase'>>): boolean {
  return calls.some(c => c.phase === 'ringing') && !calls.some(c => c.phase === 'connected')
}

// ── Ringer ──────────────────────────────────────────────────────────────────

/** The subset of HTMLAudioElement the ringer uses (faked in tests). */
export interface RingerAudio {
  loop: boolean
  muted: boolean
  paused: boolean
  currentTime: number
  play(): Promise<void> | void
  pause(): void
}

export interface Ringer {
  /** Drive the ringer from the call list. The ONLY thing that stops it. */
  sync(ring: boolean): void
  /**
   * Call from a user gesture (any tap in the app). Unlocks playback on mobile
   * browsers, and if the ringer should be ringing but the browser paused it
   * (autoplay block, iOS audio interruption), starts it again. It never stops
   * or silences the ringer.
   */
  onUserGesture(): void
  /** True once a gesture has unlocked playback, or a play() has succeeded. */
  readonly unlocked: boolean
  /** True while the ringer wants to ring. */
  readonly ringing: boolean
  dispose(): void
}

export function createRinger(createAudio: () => RingerAudio | null): Ringer {
  let audio: RingerAudio | null = null
  let ringing = false
  let unlocked = false

  const el = () => {
    if (!audio) {
      audio = createAudio()
      if (audio) audio.loop = true
    }
    return audio
  }

  const startPlayback = () => {
    const a = el()
    if (!a) return
    a.muted = false
    try {
      const p = a.play()
      if (p && typeof (p as Promise<void>).then === 'function') {
        (p as Promise<void>).then(() => { unlocked = true }, () => { /* blocked until a tap */ })
      } else {
        unlocked = true
      }
    } catch { /* blocked until a tap */ }
  }

  return {
    sync(ring: boolean) {
      if (ring === ringing) {
        // Still ringing: make sure it is actually playing (e.g. it was blocked).
        if (ring && audio?.paused) startPlayback()
        return
      }
      ringing = ring
      if (ring) {
        startPlayback()
      } else if (audio) {
        try { audio.pause() } catch { /* already stopped */ }
        try { audio.currentTime = 0 } catch { /* not seekable yet */ }
      }
    },
    onUserGesture() {
      const a = el()
      if (!a) return
      if (ringing) {
        if (a.paused) startPlayback()
        return
      }
      if (unlocked) return
      // Not ringing: a muted play-then-pause inside the gesture is what lets
      // iOS Safari and Android Chrome play this element later without one.
      a.muted = true
      try {
        const p = a.play()
        const done = () => {
          // A call may have started ringing while the unlock was in flight.
          if (ringing) a.muted = false
          else { try { a.pause() } catch { /* */ } }
          unlocked = true
        }
        if (p && typeof (p as Promise<void>).then === 'function') {
          (p as Promise<void>).then(done, () => { /* try again on the next tap */ })
        } else {
          done()
        }
      } catch { /* try again on the next tap */ }
    },
    get unlocked() { return unlocked },
    get ringing() { return ringing },
    dispose() {
      ringing = false
      if (audio) { try { audio.pause() } catch { /* */ } }
      audio = null
    },
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** Twilio Voice SDK error codes for a missing or blocked microphone. */
const MIC_ERROR_CODES = new Set([31208, 31401, 31402])

/** True when an SDK or getUserMedia error means the microphone is unavailable. */
export function isMicrophoneError(err: any): boolean {
  if (!err) return false
  if (MIC_ERROR_CODES.has(Number(err.code))) return true
  const name = String(err.name || err.originalError?.name || '')
  return name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'NotFoundError'
}

export const MIC_BLOCKED_MESSAGE =
  'Microphone access is blocked, so calls cannot connect. Allow the microphone for this site in your browser settings (on iPhone: Settings > Apps > Safari > Microphone), then try again.'
