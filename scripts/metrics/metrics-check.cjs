// node scripts/metrics/metrics-check.cjs
// Checks the Growth Dashboard's pure rules (src/lib/metrics): the test filter's pattern
// match, lead channels, rows from items (sums, breakdowns, median item rows), target pace
// and status, the previous period, and the biggest funnel drop-off. Compiles the real
// source into a temp directory; no database is touched.
const fs = require('fs'), path = require('path'), os = require('os')
const ts = require('typescript')

const SRC = path.resolve(__dirname, '..', '..', 'src', 'lib', 'metrics')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-metrics-'))
for (const f of ['registry.ts', 'dates.ts', 'test-filter.ts', 'collect.ts', 'rollup.ts', 'summary.ts']) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
  fs.writeFileSync(path.join(out, f.replace(/\.ts$/, '.js')), js)
}
const load = (m) => require(path.join(out, m))
const { likeToRegExp } = load('test-filter.js')
const { leadChannel, SCORECARD_CHANNELS } = load('collect.js')
const { toRows } = load('rollup.js')
const { targetPace, statusOf, previousRange, biggestDropOff } = load('summary.js')
const { nyDay, addDays } = load('dates.js')

let fail = 0, total = 0
const eq = (name, got, want) => {
  total++
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g !== w) { fail++; console.log(`FAIL ${name}: want ${w} got ${g}`) }
}

// test filter: LIKE patterns
const p = likeToRegExp('cameron.s.allen+%@gmail.com')
eq('pattern matches a plus address', p.test('cameron.s.allen+ctest@gmail.com'), true)
eq('pattern matches another plus address', p.test('cameron.s.allen+prod1101@gmail.com'), true)
eq('pattern: the dot is literal', p.test('cameronXs.allen+x@gmail.com'), false)
eq('pattern: the base address is not a plus address', p.test('cameron.s.allen@gmail.com'), false)
eq('pattern: someone else', p.test('sgranau+test@gmail.com'), false)

// lead channels
eq('stripe is inbound web', leadChannel('stripe'), 'inbound_web')
eq('a URL is prospecting', leadChannel('https://www.instagram.com/x/'), 'prospecting')
eq('a city is prospecting', leadChannel('Denver'), 'prospecting')
for (const v of ['unknown', 'unknown_enrolled', 'unknown_sales', 'wnw_local', 'referral']) eq(`${v} stays unknown`, leadChannel(v), 'unknown')
for (const v of ['prospect_unknown', 'partner_outreach', 'outreach_2026_06', 'instagram_research', 'linkedin_research', 'web_research']) eq(`${v} is prospecting`, leadChannel(v), 'prospecting')
eq('podcast is podcast_pr', leadChannel('podcast'), 'podcast_pr')
eq('Import is import', leadChannel('Import'), 'import')
eq('empty is unknown', leadChannel(''), 'unknown')
eq('media appearance is podcast', leadChannel('media_appearance'), 'podcast_pr')
eq('scorecard excludes prospecting and import', ['inbound_web', 'prospecting', 'import', 'unknown'].map(SCORECARD_CHANNELS), [true, false, false, true])

// rows
const rows = toRows([
  { metric: 'leads', day: '2026-11-02', value: 1, dims: { channel: 'inbound_web' } },
  { metric: 'leads', day: '2026-11-02', value: 1, dims: { channel: 'inbound_web' } },
  { metric: 'leads', day: '2026-11-02', value: 1, dims: { channel: 'unknown' } },
  { metric: 'revenue', day: '2026-11-02', value: 6500.5, dims: { stream: 'university' } },
  { metric: 'speed_to_lead', day: '2026-11-02', value: 10, rec: { id: 'a', label: 'A' } },
  { metric: 'speed_to_lead', day: '2026-11-02', value: 50, rec: { id: 'b', label: 'B' } },
  { metric: 'speed_to_lead', day: '2026-11-02', value: 90, rec: { id: 'b', label: 'B' } },
  { metric: 'not_a_metric', day: '2026-11-02', value: 1 },
])
const find = (m, dk, dv) => rows.find((r) => r.metric_key === m && r.dimension_key === dk && r.dimension_value === dv)?.value
eq('leads total', find('leads', '', ''), 3)
eq('leads by channel', [find('leads', 'channel', 'inbound_web'), find('leads', 'channel', 'unknown')], [2, 1])
eq('revenue keeps cents', find('revenue', '', ''), 6500.5)
eq('median total row', find('speed_to_lead', '', ''), 50)
eq('median item rows, duplicate ids kept apart', rows.filter((r) => r.metric_key === 'speed_to_lead' && r.dimension_key === 'item').map((r) => r.dimension_value).sort(), ['a', 'b', 'b#2'])
eq('unknown metrics are dropped', rows.some((r) => r.metric_key === 'not_a_metric'), false)

// targets: November 150 leads, prorated by day; pace counts only days up to today
const targets = [{ metric_key: 'leads', month: '2026-11-01', target_value: 150, amber_threshold: 0.9, red_threshold: 0.75 }]
const tp = targetPace(targets, 'leads', '2026-11-01', '2026-11-30', '2026-11-10')
eq('month target', Math.round(tp.target), 150)
eq('pace after 10 days', Math.round(tp.pace), 50)
eq('carries forward to December', Math.round(targetPace(targets, 'leads', '2026-12-01', '2026-12-31', '2026-12-31').target), 150)
eq('no target before November', targetPace(targets, 'leads', '2026-10-01', '2026-10-31', '2026-10-31'), null)
eq('status green at pace', statusOf(50, 50, 0.9, 0.75), 'green')
eq('status amber at 80%', statusOf(40, 50, 0.9, 0.75), 'amber')
eq('status red at 60%', statusOf(30, 50, 0.9, 0.75), 'red')
eq('no status without pace', statusOf(5, 0, 0.9, 0.75), undefined)

// previous period, days, funnel
eq('previous of this month so far', previousRange('2026-11-01', '2026-11-03'), { from: '2026-10-29', to: '2026-10-31' })
eq('previous of a week', previousRange('2026-10-27', '2026-11-02'), { from: '2026-10-20', to: '2026-10-26' })
eq('New York day before midnight UTC', nyDay('2026-11-03T03:30:00Z'), '2026-11-02')
eq('addDays across months', addDays('2026-10-31', 1), '2026-11-01')
eq('biggest drop-off', biggestDropOff({ leads: 40, booked_calls: 10, sales: 4, onboarded: 3 }), 'Leads → Booked calls: 10 of 40 (25%)')
eq('drop-off with no leads', biggestDropOff({ leads: 0, booked_calls: 0, sales: 0, onboarded: 0 }), null)

fs.rmSync(out, { recursive: true, force: true })
console.log(fail ? `metrics-check FAIL ${fail}/${total}` : `metrics-check PASS ${total}/${total}`)
process.exit(fail ? 1 : 0)
