// scripts/np-twiml-snapshot.mjs
//
// Asserts the TwiML emitted for an inbound call on a line with NO
// forward_number (the Neuro Progeny main line) — the multi-line work's
// non-negotiable. Run:  npm run check:twiml
//
// The <Dial> and every attribute on it are byte-identical to what shipped in
// 2d1e9da. The ONLY difference is the <Client> noun's shape: design decision D3
// added an inert <Parameter name="line"> so the ringing modal can say which
// line was dialled, and Twilio requires the <Identity> child form for that.
// Check 2 strips exactly that addition and compares against the pre-D3 string,
// so any other drift fails.
//
// Runs under plain `node` (v24: TypeScript type-stripping is on by default).
// inbound-voice.ts uses RELATIVE imports for this reason; the loader hook below
// only appends ".ts" when a bare relative specifier does not resolve.

import { register, createRequire } from 'node:module'

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    try {
      return await next(specifier, context)
    } catch (e) {
      if (specifier.startsWith('.') && !/\\.[cm]?[jt]s$/.test(specifier)) {
        return next(specifier + '.ts', context)
      }
      throw e
    }
  }
`))

const require = createRequire(import.meta.url)
const twilio = require('twilio')
const { appendRingDial, appendVoicemail } = await import(
  new URL('../src/lib/inbound-voice.ts', import.meta.url).href
)

const ORG = '00000000-0000-0000-0000-000000000001'
const APP = 'https://hub.neuroprogeny.com'
const NP = '+18284155050'
const WNW = '+18289009821'

let failures = 0
function check(name, actual, expected) {
  if (actual === expected) { console.log('ok   -', name); return }
  failures++
  console.log('FAIL -', name)
  console.log('  expected:', expected)
  console.log('  actual:  ', actual)
}

function twiml(build) {
  const r = new twilio.twiml.VoiceResponse()
  build(r)
  return r.toString()
}

// 1. NP line, as shipped now.
const np = twiml(r => appendRingDial(r, {
  orgId: ORG, appUrl: APP, ringTimeoutSeconds: 20,
  lineE164: NP, forwardNumber: '', callerE164: '+15555550123',
}))
check('NP line: exact TwiML',
  np,
  '<?xml version="1.0" encoding="UTF-8"?><Response>'
  + `<Dial timeout="20" action="${APP}/api/twilio/ring-complete" method="POST">`
  + `<Client><Identity>org-${ORG}</Identity><Parameter name="line" value="${NP}"/></Client>`
  + '</Dial></Response>')

// 2. NP line with the D3 parameter stripped == the pre-D3 document (2d1e9da).
const preD3 = np.replace(
  `<Client><Identity>org-${ORG}</Identity><Parameter name="line" value="${NP}"/></Client>`,
  `<Client>org-${ORG}</Client>`)
check('NP line: everything but the D3 parameter is byte-identical to 2d1e9da',
  preD3,
  '<?xml version="1.0" encoding="UTF-8"?><Response>'
  + `<Dial timeout="20" action="${APP}/api/twilio/ring-complete" method="POST">`
  + `<Client>org-${ORG}</Client>`
  + '</Dial></Response>')

// 3. NP line never carries callerId, `caller` or <Number>, whatever the caller.
check('NP line: no callerId / caller parameter / Number',
  [/callerId=/.test(np), /name="caller"/.test(np), /<Number>/.test(np)].join(','),
  'false,false,false')

// 4. Forwarding line: browser + cell in one <Dial>, callerId = the dialled line.
const wnw = twiml(r => appendRingDial(r, {
  orgId: ORG, appUrl: APP, ringTimeoutSeconds: 15,
  lineE164: WNW, forwardNumber: '(828) 555-0199', callerE164: '+15555550123',
}))
check('WNW line: simultaneous ring TwiML',
  wnw,
  '<?xml version="1.0" encoding="UTF-8"?><Response>'
  + `<Dial timeout="15" action="${APP}/api/twilio/ring-complete" method="POST" callerId="${WNW}">`
  + `<Client><Identity>org-${ORG}</Identity>`
  + `<Parameter name="caller" value="+15555550123"/><Parameter name="line" value="${WNW}"/></Client>`
  + '<Number>+18285550199</Number>'
  + '</Dial></Response>')

// 5. Voicemail: URL beats text beats default; the default is unchanged.
check('voicemail: greeting_url wins',
  twiml(r => appendVoicemail(r, { greetingUrl: 'https://x/g.wav', greetingText: 'hi', appUrl: '' })),
  '<?xml version="1.0" encoding="UTF-8"?><Response><Play>https://x/g.wav</Play>'
  + '<Record maxLength="120" playBeep="true"/>'
  + '<Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say></Response>')
check('voicemail: greeting_text via Polly.Joanna-Neural',
  twiml(r => appendVoicemail(r, { greetingUrl: '', greetingText: 'Thanks for calling.', appUrl: '' })),
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna-Neural">Thanks for calling.</Say>'
  + '<Record maxLength="120" playBeep="true"/>'
  + '<Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say></Response>')
check('voicemail: default unchanged',
  twiml(r => appendVoicemail(r, { greetingUrl: '', appUrl: '' })),
  '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">Please leave a message after the tone.</Say>'
  + '<Record maxLength="120" playBeep="true"/>'
  + '<Say voice="Polly.Joanna">We did not receive a message. Goodbye.</Say></Response>')

if (failures) { console.log(`\n${failures} check(s) FAILED`); process.exit(1) }
console.log('\nall TwiML snapshot checks passed')
