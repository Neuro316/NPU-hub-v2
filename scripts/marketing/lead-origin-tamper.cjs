#!/usr/bin/env node
// scripts/marketing/lead-origin-tamper.cjs
//
// start.neuroprogeny.com skips the Hub login, so that must stay narrow. Checks:
//   O_HOST   only that exact host counts; hub.neuroprogeny.com never does
//   O_PATH   only a device slug and its file, submit and track paths are served
//   O_FRAME  the ruled embed origins, plus plain https origins from the manifest; no University
//   O_MW     the middleware checks the host first, drops cookies, and still ends in updateSession
//   O_API    /api is refused on that host and no other
//
//   anyhost   a subdomain of the host also counts       {O_HOST}
//   hubhost   the Hub host counts in its place          {O_HOST}
//   anypath   any path is served                        {O_PATH}
//   looseorg  any manifest string may frame a device    {O_FRAME}
//   keepcook  the middleware keeps the cookie header    {O_MW}
//   noapi     the /api redirect loses its host limit    {O_API}
// TAMPER=1 reddens the union (5).
const fs = require('fs'), path = require('path')
const H = require('../agent/lib/harness.cjs')

const F = 'lib/lead-devices/public-origin.ts'
const TAMPERS = {
  anyhost: [[F, ".split(':')[0] === LEAD_DEVICE_HOST", ".split(':')[0].endsWith(LEAD_DEVICE_HOST)"]],
  hubhost: [[F, "export const LEAD_DEVICE_HOST = 'start.neuroprogeny.com'", "export const LEAD_DEVICE_HOST = 'hub.neuroprogeny.com'"]],
  anypath: [[F, "if (parts.length > 2 || !SLUG.test(parts[0])) return null\n  if (parts.length === 2 && !SUBPATHS.has(parts[1])) return null\n", '']],
  looseorg: [[F, "typeof o === 'string' && PUBLIC_HTTPS_ORIGIN.test(o)", "typeof o === 'string'"]],
  keepcook: [],
  noapi: [],
}
const RED_OF = { anyhost: ['O_HOST'], hubhost: ['O_HOST'], anypath: ['O_PATH'], looseorg: ['O_FRAME'], keepcook: ['O_MW'], noapi: ['O_API'] }
const active = H.selectors(TAMPERS)
const out = H.compile(TAMPERS, active, 'hub-leadorigin')
const load = H.install(out)
const { isLeadDeviceHost, leadDeviceRoute, frameAncestors, FRAME_ANCESTORS } = load(F)

const rows = []
const check = (id, ok, got) => rows.push({ id, ok: !!ok, got })

const yesHosts = ['start.neuroprogeny.com', 'START.neuroprogeny.com', 'start.neuroprogeny.com:443']
const noHosts = ['hub.neuroprogeny.com', 'go.neuroprogeny.com', 'university.neuroprogeny.com', 'evil.start.neuroprogeny.com', 'start.neuroprogeny.com.evil.test', 'localhost:3000', '', null, undefined]
check('O_HOST', yesHosts.every(isLeadDeviceHost) && !noHosts.some(isLeadDeviceHost), noHosts.filter(isLeadDeviceHost))

const served = { '/sleep-quiz': '/lead-device/sleep-quiz', '/sleep-quiz/file': '/lead-device/sleep-quiz/file', '/a1/submit': '/lead-device/a1/submit', '/a1/track': '/lead-device/a1/track' }
const refused = ['/', '/api/intake', '/api/cron/x', '/crm/contacts', '/Sleep', '/sleep-quiz/other', '/sleep-quiz/file/x', '/lead-device/x/file', '/a--b', '/x.png']
check('O_PATH', Object.entries(served).every(([p, r]) => leadDeviceRoute(p) === r) && refused.every((p) => leadDeviceRoute(p) === null), refused.filter((p) => leadDeviceRoute(p) !== null))

const base = frameAncestors(undefined)
const withExtra = frameAncestors(['https://podcast.example.com', 'http://plain.example.com', 'https://*.example.com', 'https://x.example.com/path', "'self'", 7])
const want = ['https://hub.neuroprogeny.com', 'https://neuroprogeny.com', 'https://www.neuroprogeny.com', 'https://transitions.neuroprogeny.com', 'https://waynesvilleneuro.com', 'https://www.waynesvilleneuro.com']
check('O_FRAME',
  base === `frame-ancestors ${want.join(' ')}` && FRAME_ANCESTORS.length === 6 && !base.includes('university')
  && withExtra === `${base} https://podcast.example.com`, withExtra)

const ROOT = path.resolve(__dirname, '..', '..')
let mw = fs.readFileSync(path.join(ROOT, 'src', 'middleware.ts'), 'utf8').replace(/\r\n/g, '\n')
if (active.includes('keepcook')) mw = mw.replace("headers.delete('cookie')\n", '')
const hostAt = mw.indexOf("if (isLeadDeviceHost(request.headers.get('host')))"), sessionAt = mw.indexOf('return await updateSession(request)')
check('O_MW', hostAt > 0 && sessionAt > hostAt && mw.includes("headers.delete('cookie')") && !/updateSession\([^)]*\)[\s\S]*isLeadDeviceHost\(/.test(mw), { hostAt, sessionAt })

const config = require(path.join(ROOT, 'next.config.js'))
;(async () => {
  const rules = await config.redirects()
  if (active.includes('noapi')) delete rules[0].has
  const r = rules.find((x) => x.source === '/api/:path*')
  check('O_API', rules.length === 1 && r && r.permanent === false && r.has && r.has.length === 1 && r.has[0].type === 'host' && r.has[0].value === 'start.neuroprogeny.com', r)
  H.report(rows, active, RED_OF, () => fs.rmSync(out, { recursive: true, force: true }))
})()
