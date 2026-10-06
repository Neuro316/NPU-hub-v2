#!/usr/bin/env node
// scripts/click-to-call/dialer-hangup-tamper.cjs   (the CRM dialer's in-call controls act on the real call)
//
// Before this fix the dialer's Hang up only reset the screen: the Twilio call was a local variable
// nothing could reach, so it stayed connected. The real DialerCall runs here against a fake Twilio
// Device that records what is done to it.
//   D_HANGUP   Hang up during a call disconnects the call (once) and tells the screen it ended (once)
//   D_EARLY    Hang up pressed while the call is still being placed disconnects it as soon as it exists
//   D_TOKEN    Hang up before the token arrives places no call at all
//   D_RELEASE  the Twilio device is destroyed when the call ends: by Hang up, mid-dial, or the far end
//   D_MUTE     Mute mutes the call, and unmute unmutes it
//   D_DIGITS   an in-call key press is sent to the call as a tone; anything else is not
//   D_WIRED    the dialer page uses it: Hang up calls hangUp, the Mute button calls toggleMute, key
//              presses go to sendDigit during a call, and leaving the page hangs up (comments stripped)
//
//   nohangup   Hang up no longer disconnects the call                {D_HANGUP}
//   noearly    a call that arrives after Hang up is kept             {D_EARLY}
//   notoken    Hang up before the token no longer stops the call     {D_TOKEN}
//   nodestroy  the device is never destroyed                         {D_RELEASE}
//   nomute     Mute changes nothing                                  {D_MUTE}
//   nodigits   key presses are not sent                              {D_DIGITS}
//   unwired    the page's Hang up goes back to resetting the screen   {D_WIRED}
// TAMPER=1 reddens the union (7, equal to the sum).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const TAMPERS = {
  nohangup: [['lib/dialer-call.ts', '    if (this.call) { try { this.call.disconnect() } catch { /* already gone */ } }\n', '']],
  noearly: [['lib/dialer-call.ts', "    if (this.hungUp) { try { call.disconnect() } catch { /* already gone */ } this.finish(); return }\n", '']],
  notoken: [['lib/dialer-call.ts', '    if (this.hungUp) return // Hang up before the token even arrived: place nothing\n', '']],
  nodestroy: [['lib/dialer-call.ts', '    if (this.device) { try { this.device.destroy() } catch { /* already gone */ } }\n', '']],
  nomute: [['lib/dialer-call.ts', 'setMuted(muted: boolean): void { if (this.call) this.call.mute(muted) }', 'setMuted(muted: boolean): void { }']],
  nodigits: [['lib/dialer-call.ts', "sendDigit(d: string): void { if (this.call && /^[0-9*#]$/.test(d)) this.call.sendDigits(d) }", 'sendDigit(d: string): void { }']],
  unwired: [],
}
const RED_OF = { nohangup: ['D_HANGUP'], noearly: ['D_EARLY'], notoken: ['D_TOKEN'], nodestroy: ['D_RELEASE'], nomute: ['D_MUTE'], nodigits: ['D_DIGITS'], unwired: ['D_WIRED'] }
const active = H.selectors(TAMPERS)
const out = H.compile(Object.fromEntries(Object.entries(TAMPERS).filter(([k]) => k !== 'unwired')), active.filter((t) => t !== 'unwired'), 'hub-dialer')
const load = H.install(out)
const { DialerCall } = load('lib/dialer-call.ts')

// a fake Twilio Device and Call that record everything done to them
function fakeTwilio({ delayed = false } = {}) {
  const log = { devices: 0, destroyed: 0, disconnects: 0, mutes: [], digits: [], handlers: {} }
  let release
  const call = {
    on: (ev, fn) => { (log.handlers[ev] = log.handlers[ev] || []).push(fn) },
    disconnect: () => { log.disconnects++; (log.handlers.disconnect || []).forEach((f) => f()) },
    mute: (m) => log.mutes.push(m),
    sendDigits: (d) => log.digits.push(d),
  }
  const factory = () => { log.devices++; return {
    connect: () => (delayed ? new Promise((r) => { release = () => r(call) }) : Promise.resolve(call)),
    destroy: () => { log.destroyed++ } } }
  return { log, call, factory, release: () => release && release() }
}
const counter = () => { const c = { ended: 0, connected: 0, ringing: 0 }; return { c, events: { onEnded: () => c.ended++, onConnected: () => c.connected++, onRinging: () => c.ringing++ } } }

;(async () => {
  const rows = []
  const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })
  const releases = []

  // Hang up during a connected call
  {
    const t = fakeTwilio(); const k = counter(); const ctl = new DialerCall(t.factory, k.events)
    await ctl.start('tok', { To: '+1' }); (t.log.handlers.accept || []).forEach((f) => f())
    ctl.hangUp(); ctl.hangUp()
    check('D_HANGUP', t.log.disconnects === 1 && k.c.ended === 1 && k.c.connected === 1 && !ctl.active, { disconnects: t.log.disconnects, ended: k.c.ended })
    releases.push(['hangup', t.log.destroyed])
  }
  // Hang up while the call is still being placed
  {
    const t = fakeTwilio({ delayed: true }); const k = counter(); const ctl = new DialerCall(t.factory, k.events)
    const p = ctl.start('tok', { To: '+1' })
    await new Promise((r) => setTimeout(r, 0))
    ctl.hangUp()
    t.release(); await p
    check('D_EARLY', t.log.disconnects === 1 && k.c.ended === 1 && k.c.ringing === 0 && !ctl.active, { disconnects: t.log.disconnects, ended: k.c.ended, ringing: k.c.ringing })
    releases.push(['early', t.log.destroyed])
  }
  // Hang up before the token arrived
  {
    const t = fakeTwilio(); const k = counter(); const ctl = new DialerCall(t.factory, k.events)
    ctl.hangUp(); await ctl.start('tok', { To: '+1' })
    check('D_TOKEN', t.log.devices === 0 && k.c.ended === 1, { devices: t.log.devices, ended: k.c.ended })
  }
  // the far end hangs up
  {
    const t = fakeTwilio(); const k = counter(); const ctl = new DialerCall(t.factory, k.events)
    await ctl.start('tok', { To: '+1' }); (t.log.handlers.disconnect || []).forEach((f) => f())
    releases.push(['remote', t.log.destroyed])
    check('D_RELEASE', releases.every(([, n]) => n >= 1) && k.c.ended === 1, releases)
  }
  // Mute and keypad
  {
    const t = fakeTwilio(); const ctl = new DialerCall(t.factory, {})
    await ctl.start('tok', { To: '+1' })
    ctl.setMuted(true); ctl.setMuted(false)
    check('D_MUTE', JSON.stringify(t.log.mutes) === JSON.stringify([true, false]), t.log.mutes)
    ctl.sendDigit('5'); ctl.sendDigit('#'); ctl.sendDigit('x')
    check('D_DIGITS', JSON.stringify(t.log.digits) === JSON.stringify(['5', '#']), t.log.digits)
  }
  // the page uses it
  {
    let page = fs.readFileSync(path.join(H.SRC, 'app', '(dashboard)', 'crm', 'dialer', 'page.tsx'), 'utf8').replace(/\r\n/g, '\n')
    if (active.includes('unwired')) {
      const from = '    if (callCtl.current) callCtl.current.hangUp()\n    else showEnded()'
      if (!page.includes(from)) { console.error('dead anchor: unwired'); process.exit(2) }
      page = page.replace(from, '    showEnded()')
    }
    const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const endCall = (code.match(/function endCall\(\) \{[\s\S]*?\n  \}/) || [''])[0]
    const pressKey = (code.match(/function pressKey\(d: string\) \{[\s\S]*?\n  \}/) || [''])[0]
    const wired = /import \{ DialerCall \} from '@\/lib\/dialer-call'/.test(code) && /\.hangUp\(\)/.test(endCall)
      && /<button onClick=\{toggleMute\}/.test(code) && /sendDigit\(d\)/.test(pressKey)
      && /useEffect\(\(\) => \(\) => \{ callCtl\.current\?\.hangUp\(\) \}, \[\]\)/.test(code)
    check('D_WIRED', wired, { endCall: endCall.slice(0, 120) })
  }

  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})().catch((e) => { console.error(e); process.exit(2) })
