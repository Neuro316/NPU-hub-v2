// src/lib/dialer-call.ts
// One outbound call from the CRM dialer: the Twilio Device and Call it creates are kept here, so
// Hang up, Mute and the in-call keypad act on the real call instead of only on what the screen
// shows. (Before this, the dialer created the call as a local variable and its Hang up button only
// reset the screen, so the call stayed connected.)
//
// Hang up during dialing is honoured: if the call object arrives after Hang up was pressed, it is
// disconnected as soon as it exists. The Device is destroyed when the call ends, so no registration
// is left behind. The Device constructor is injected, so this can be tested without a browser.

export interface CallLike {
  on(event: 'accept' | 'disconnect' | 'cancel' | 'reject' | 'error', fn: (...args: any[]) => void): unknown
  disconnect(): void
  mute(shouldMute: boolean): void
  sendDigits(digits: string): void
}
export interface DeviceLike {
  connect(opts: { params: Record<string, string> }): Promise<CallLike>
  destroy(): void
}
export type DeviceFactory = (token: string) => DeviceLike

export interface CallEvents {
  onRinging?: () => void
  onConnected?: () => void
  onEnded?: () => void
  onError?: (e: unknown) => void
}

export class DialerCall {
  private device: DeviceLike | null = null
  private call: CallLike | null = null
  private hungUp = false
  private ended = false

  constructor(private makeDevice: DeviceFactory, private events: CallEvents = {}) {}

  /** Places the call. Resolves once the call object exists (or was cancelled by Hang up). */
  async start(token: string, params: Record<string, string>): Promise<void> {
    if (this.hungUp) return // Hang up before the token even arrived: place nothing
    this.device = this.makeDevice(token)
    let call: CallLike
    try { call = await this.device.connect({ params }) } catch (e) { this.finish(); this.events.onError?.(e); return }
    // Hang up was pressed while the call was still being placed: end it now
    if (this.hungUp) { try { call.disconnect() } catch { /* already gone */ } this.finish(); return }
    this.call = call
    this.events.onRinging?.()
    call.on('accept', () => this.events.onConnected?.())
    for (const ev of ['disconnect', 'cancel', 'reject'] as const) call.on(ev, () => this.finish())
    call.on('error', (e: unknown) => { this.events.onError?.(e); this.hangUp() })
  }

  /** Ends the call for real, whatever stage it is at. Safe to call more than once. */
  hangUp(): void {
    this.hungUp = true
    if (this.call) { try { this.call.disconnect() } catch { /* already gone */ } }
    this.finish()
  }

  setMuted(muted: boolean): void { if (this.call) this.call.mute(muted) }

  /** A keypad press during the call is sent to the far end as a tone (phone menus). */
  sendDigit(d: string): void { if (this.call && /^[0-9*#]$/.test(d)) this.call.sendDigits(d) }

  get active(): boolean { return !!this.call && !this.ended }

  // teardown runs every time (a device created after an early Hang up is still destroyed);
  // onEnded fires once
  private finish(): void {
    if (this.device) { try { this.device.destroy() } catch { /* already gone */ } }
    this.device = null
    this.call = null
    if (this.ended) return
    this.ended = true
    this.events.onEnded?.()
  }
}
