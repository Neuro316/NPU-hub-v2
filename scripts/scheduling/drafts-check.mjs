// node --experimental-strip-types scripts/scheduling/drafts-check.mjs
// Checks the pure draft builders (src/lib/scheduling/draft-compose.ts): no em or en dash ever, the headers,
// Re: handling, the Reply-To domain rule, the first-name fallback, exactly one recipient, nothing quoted.
import {
  slotsText, linkText, exceptionSms, assertNoDash, firstName, chooseRecipient, parseAddresses, replySubject,
  buildRfc2822, base64url, isSensitive, draftCategory, encodeHeader,
} from '../../src/lib/scheduling/draft-compose.ts'

const results = []
const check = (name, ok, detail = '') => results.push({ name, ok: !!ok, detail })
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `want ${JSON.stringify(want)} got ${JSON.stringify(got)}`)
const throws = (name, fn) => { try { fn(); check(name, false, 'did not throw') } catch { check(name, true) } }
const DASH = /[–—]/
const headersOf = (raw) => raw.split('\r\n\r\n')[0].split('\r\n')
const bodyOf = (raw) => Buffer.from(raw.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8')

// ── text ───────────────────────────────────────────────────────────────────
{
  const t = slotsText('Dana', ['Tue, Nov 10 at 10:00 AM', 'Wed, Nov 11 at 9:00 AM'])
  eq('slots text exact', t, "Hi Dana,\n\nThanks for reaching out. Here are a few times that work on my end (Eastern):\n\nTue, Nov 10 at 10:00 AM\nWed, Nov 11 at 9:00 AM\n\nLet me know which works best and I'll send an invite.\n\nCameron")
  check('slots text has no em or en dash', !DASH.test(t))
  check('no first name: Hi there,', slotsText(null, ['Tue, Nov 10 at 10:00 AM']).startsWith('Hi there,\n'))
  const l = linkText('Dana', 'https://university.neuroprogeny.com/book/discovery')
  eq('link text exact', l, 'Hi Dana,\n\nThanks for reaching out. The easiest way to find a time is my booking page: https://university.neuroprogeny.com/book/discovery\n\nLooking forward to it.\n\nCameron')
  check('link text has no dash', !DASH.test(l))
  check('link text, no name', linkText(null, 'https://x.example/b').startsWith('Hi there,'))
  throws('an http link is refused', () => linkText('A', 'http://x.example/b'))
  throws('a slot label with an en dash is refused', () => slotsText('A', ['Tue 10:00–10:30']))
  throws('an em dash anywhere is refused', () => assertNoDash('a — b'))
  throws('no slots is refused', () => slotsText('A', []))
  const sms = exceptionSms('Dana', 'https://hub.example.com/')
  eq('exception sms', sms, 'Scheduling: no open time for a request from Dana. Approve or decline in the Hub: https://hub.example.com/mail')
  check('exception sms without a name', exceptionSms(null, 'https://h').includes('from a new sender.'))
}

// ── first name ─────────────────────────────────────────────────────────────
{
  eq('first of two', firstName('Dana Smith'), 'Dana')
  eq('quoted', firstName('"Dana Smith"'), 'Dana')
  eq('Last, First', firstName('Smith, Dana'), 'Dana')
  eq('all caps title-cased', firstName('DANA SMITH'), 'Dana')
  eq('lowercase title-cased', firstName('dana'), 'Dana')
  eq('mixed case kept', firstName('McKenzie Ray'), 'McKenzie')
  eq('accented kept', firstName('Zoë Adams'), 'Zoë')
  eq('an address is not a name', firstName('dana@x.com'), null)
  eq('empty', firstName(''), null)
  eq('null', firstName(null), null)
  eq('initial only', firstName('J. Smith'), null)
  eq('digits first', firstName('42 Team'), null)
  eq('emoji', firstName('😀 Dana'), null)
}

// ── recipient ──────────────────────────────────────────────────────────────
{
  eq('From only', chooseRecipient('Dana <Dana@Acme.com>', null), 'dana@acme.com')
  eq('Reply-To same domain wins', chooseRecipient('Dana <dana@acme.com>', 'Bookings <bookings@acme.com>'), 'bookings@acme.com')
  eq('Reply-To other domain ignored', chooseRecipient('Dana <dana@acme.com>', 'x@evil.example'), 'dana@acme.com')
  eq('Reply-To subdomain is a different domain', chooseRecipient('dana@acme.com', 'a@mail.acme.com'), 'dana@acme.com')
  eq('two Reply-To addresses ignored', chooseRecipient('dana@acme.com', 'a@acme.com, b@acme.com'), 'dana@acme.com')
  eq('two From addresses: no recipient', chooseRecipient('a@acme.com, b@acme.com', null), null)
  eq('bad From: no recipient', chooseRecipient('not an address', null), null)
  eq('quoted comma in a display name', parseAddresses('"Smith, Dana" <dana@acme.com>'), ['dana@acme.com'])
  eq('always one string', typeof chooseRecipient('"Smith, Dana" <dana@acme.com>', '"Ops, Team" <ops@acme.com>'), 'string')
}

// ── subject ────────────────────────────────────────────────────────────────
{
  eq('adds Re:', replySubject('Quick call?'), 'Re: Quick call?')
  eq('no doubling', replySubject('Re: Quick call?'), 'Re: Quick call?')
  eq('no doubling, other case', replySubject('RE: Quick call?'), 'RE: Quick call?')
  eq('no doubling, no space', replySubject('re:Quick'), 're:Quick')
  eq('empty subject', replySubject(''), 'Re: Scheduling')
  eq('newline stripped', replySubject('a\r\nBcc: x@y.com'), 'Re: a Bcc: x@y.com')
  check('non-ASCII subject is RFC 2047', encodeHeader('Re: Café').startsWith('=?UTF-8?B?'))
}

// ── RFC 2822 ───────────────────────────────────────────────────────────────
{
  const body = slotsText('Dana', ['Tue, Nov 10 at 10:00 AM'])
  const raw = buildRfc2822({ from: 'cameron@neuroprogeny.com', to: 'dana@acme.com', subject: 'Quick call?', messageId: '<abc123@mail.acme.com>', body })
  const h = headersOf(raw)
  eq('From', h.find((x) => x.startsWith('From:')), 'From: cameron@neuroprogeny.com')
  eq('To', h.find((x) => x.startsWith('To:')), 'To: dana@acme.com')
  eq('Subject', h.find((x) => x.startsWith('Subject:')), 'Subject: Re: Quick call?')
  eq('In-Reply-To', h.find((x) => x.startsWith('In-Reply-To:')), 'In-Reply-To: <abc123@mail.acme.com>')
  eq('References', h.find((x) => x.startsWith('References:')), 'References: <abc123@mail.acme.com>')
  check('text/plain UTF-8', h.includes('Content-Type: text/plain; charset="UTF-8"'))
  eq('exactly one recipient header', h.filter((x) => /^(to|cc|bcc):/i.test(x)).length, 1)
  check('no Cc or Bcc', !h.some((x) => /^(cc|bcc):/i.test(x)))
  check('no attachment', !/multipart|Content-Disposition/i.test(raw))
  check('CRLF line ends only', !/[^\r]\n/.test(raw))
  eq('body round-trips', bodyOf(raw), body.replace(/\n/g, '\r\n'))
  check('body has no dash', !DASH.test(bodyOf(raw)))
  const nomid = headersOf(buildRfc2822({ from: 'c@neuroprogeny.com', to: 'd@acme.com', subject: 'x', messageId: 'junk', body: 'Hi there,' }))
  check('a junk Message-ID adds no threading headers', !nomid.some((x) => /^(In-Reply-To|References):/.test(x)))
  throws('two addresses in To are refused', () => buildRfc2822({ from: 'c@neuroprogeny.com', to: 'a@x.com, b@x.com', subject: 'x', messageId: null, body: 'Hi' }))
  throws('header injection via To is refused', () => buildRfc2822({ from: 'c@neuroprogeny.com', to: 'a@x.com\r\nBcc: b@x.com', subject: 'x', messageId: null, body: 'Hi' }))
  throws('a dash in the body is refused', () => buildRfc2822({ from: 'c@neuroprogeny.com', to: 'a@x.com', subject: 'x', messageId: null, body: 'a — b' }))
  const inj = headersOf(buildRfc2822({ from: 'c@neuroprogeny.com', to: 'a@x.com', subject: 'x\r\nBcc: b@x.com', messageId: '<a@b>\r\nBcc: c@d', body: 'Hi' }))
  check('no injected Bcc from subject or Message-ID', !inj.some((x) => /^bcc:/i.test(x)))
  eq('base64url has no + / =', /[+/=]/.test(base64url(raw + '??>>')), false)
  eq('base64url decodes', Buffer.from(base64url('Hi é'), 'base64url').toString('utf8'), 'Hi é')
}

// ── flagging and category ──────────────────────────────────────────────────
{
  check('legal flagged', isSensitive('Contract review call', null))
  check('therapy flagged', isSensitive(null, 'Asks about therapy options'))
  check('plain meeting not flagged', !isSensitive('Can we meet next week?', 'Wants a 30 minute call'))
  eq('trusted sender is team_familiar', draftCategory({ trustedSender: true, subject: 'podcast' }), 'team_familiar')
  eq('podcast', draftCategory({ trustedSender: false, subject: 'Guest on our show?' }), 'podcast')
  eq('in person', draftCategory({ trustedSender: false, summary: 'Wants to grab coffee' }), 'in_person')
  eq('default one_on_one', draftCategory({ trustedSender: false, subject: 'Quick call?' }), 'one_on_one')
}

const failed = results.filter((r) => !r.ok)
for (const f of failed) console.log(`FAIL ${f.name}: ${f.detail}`)
console.log(failed.length ? `DRAFTS_CHECK FAIL ${results.length - failed.length}/${results.length}` : `DRAFTS_CHECK PASS ${results.length}/${results.length}`)
process.exit(failed.length ? 1 : 0)
