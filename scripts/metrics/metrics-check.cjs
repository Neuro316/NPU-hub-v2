// node scripts/metrics/metrics-check.cjs
// Checks the Growth Dashboard's pure rules (src/lib/metrics): the test filter's pattern
// match, lead channels, rows from items (sums, breakdowns, median item rows), target pace
// and status, the previous period, and the biggest funnel drop-off. Compiles the real
// source into a temp directory; no database is touched.
const fs = require('fs'), path = require('path'), os = require('os')
const ts = require('typescript')

const SRC = path.resolve(__dirname, '..', '..', 'src', 'lib', 'metrics')
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-metrics-'))
for (const f of ['registry.ts', 'dates.ts', 'targets.ts', 'test-filter.ts', 'collect.ts', 'rollup.ts', 'summary.ts']) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8')
  const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText
    // the pipeline positions reader needs a database; the pure rules under test never call it
    .replace(/require\("@\/lib\/pipelines\/positions"\)/g, 'require("./positions-stub.js")')
  fs.writeFileSync(path.join(out, f.replace(/\.ts$/, '.js')), js)
}
fs.writeFileSync(path.join(out, 'positions-stub.js'), 'exports.loadPositions = async () => []\n')
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
eq('biggest drop-off', biggestDropOff({ leads: 40, booked_calls: 10, phase1_sales: 4, onboarded: 3 }), 'Leads → Booked calls: 10 of 40 (25%)')
eq('drop-off with no leads', biggestDropOff({ leads: 0, booked_calls: 0, phase1_sales: 0, onboarded: 0 }), null)

// ─── targets both ways (2026-11-09) ──────────────────────────────────────────
const T = load('targets.js')
const R = load('registry.js')
eq('lower: at target is green', T.statusOf(20, 20, 1, 1.25, 'lower'), 'green')
eq('lower: 10% over is amber', T.statusOf(22, 20, 1, 1.25, 'lower'), 'amber')
eq('lower: 30% over is red', T.statusOf(26, 20, 1, 1.25, 'lower'), 'red')
eq('capacity 85% is green', T.statusOf(85, 100, 0.9, 1, 'lower'), 'green')
eq('capacity 95% is amber', T.statusOf(95, 100, 0.9, 1, 'lower'), 'amber')
eq('capacity exactly 100% is amber', T.statusOf(100, 100, 0.9, 1, 'lower'), 'amber')
eq('capacity 101% is red', T.statusOf(101, 100, 0.9, 1, 'lower'), 'red')
eq('higher is the default direction', T.statusOf(30, 50, 0.9, 0.75), 'red')
eq('thresholds: higher valid', T.validThresholds('higher', 0.9, 0.75), true)
eq('thresholds: higher above 100% refused', T.validThresholds('higher', 1.1, 0.75), false)
eq('thresholds: lower capacity valid', T.validThresholds('lower', 0.9, 1), true)
eq('thresholds: lower red under amber refused', T.validThresholds('lower', 1.2, 1), false)
const tg = [
  { metric_key: 'close_rate', month: '2026-11-01', target_value: 25, amber_threshold: 0.9, red_threshold: 0.75, direction: 'higher' },
  { metric_key: 'cost_per_lead', month: '2026-11-01', target_value: 40, amber_threshold: 1, red_threshold: 1.25, direction: 'lower' },
  { metric_key: 'phase1_sales', month: '2026-11-01', target_value: 30, amber_threshold: 0.9, red_threshold: 0.75, direction: 'higher' },
  { metric_key: 'coaching_hours_booked', month: '2026-11-01', target_value: 10, amber_threshold: 0.9, red_threshold: 0.75, direction: 'higher' },
  { metric_key: 'days_to_consent', month: '2026-11-01', target_value: 2, amber_threshold: 1, red_threshold: 1.25 }, // no direction yet
]
const ev = (k, v, from = '2026-11-01', to = '2026-11-10', today = '2026-11-10') => T.evaluate(tg, k, v, from, to, today)
eq('ratio target is a level, not prorated', [ev('close_rate', 24).target, ev('close_rate', 24).status], [25, 'green'])
eq('ratio below red', ev('close_rate', 15).status, 'red')
eq('cost per lead under target is green', ev('cost_per_lead', 35).status, 'green')
eq('cost per lead 30% over is red', ev('cost_per_lead', 52).status, 'red')
eq('sum target is prorated: 10 of 30 days', Math.round(ev('phase1_sales', 10).pace), 10)
eq('forward sum is compared with the whole month', Math.round(ev('coaching_hours_booked', 9, '2026-11-01', '2026-11-30').pace), 10)
eq('a row with no direction uses the metric (days: lower)', ev('days_to_consent', 3).direction, 'lower')
eq('no target, no status', ev('show_rate', 50), null)

// targetable: ratios, medians and the coaching split; attach is information only; outcomes never
for (const k of ['close_rate', 'lead_to_booked_rate', 'speed_to_lead', 'cost_per_lead', 'cost_per_client', 'days_lead_to_purchase', 'show_rate', 'booked_calls', 'shows', 'phase1_sales', 'phase23_conversion', 'coaching_hours_booked', 'coaching_hours_60', 'coaching_hours_30', 'coaching_capacity_used', 'days_to_consent', 'days_to_pairing', 'days_to_first_session', 'core_revenue', 'revenue'])
  eq(`${k} takes a target`, R.TARGETABLE.includes(k), true)
for (const k of ['coaching_attach_30', 'coaching_attach_60', 'coaching_committed_hours', 'clarity_sales', 'phase1_buyers', 'self_report_change', 'active_clients'])
  eq(`${k} takes no target`, R.TARGETABLE.includes(k), false)
eq('registry: every ratio part exists', R.METRICS.filter(m => m.agg === 'ratio').every(m => R.METRIC[m.num] && R.METRIC[m.den]), true)
eq('scorecard leads with the product line', R.METRICS.filter(m => m.tab === 'scorecard' && !m.hidden).slice(0, 8).map(m => m.key),
  ['phase1_sales', 'phase23_conversion', 'coaching_attach_30', 'coaching_attach_60', 'core_revenue', 'leads', 'booked_calls', 'shows'])
eq('clarity is off the scorecard', R.METRIC.clarity_sales.tab, 'sales')

// work back from the goal: 30 onboarded, close 25%, show 80%, lead to booked 20%
const wb = T.workBack(30, 0.25, 0.8, 0.2)
eq('work back per month', wb.month, { leads: 600, booked_calls: 120, shows: 96 })
eq('work back per week', wb.week, { leads: 139, booked_calls: 28, shows: 23 })
eq('work back names what is missing', T.workBack(30, null, 0.8, 0).missing, ['a close rate', 'a lead to booked rate'])

// ─── product line ────────────────────────────────────────────────────────────
const C = load('collect.js')
const kinds = {
  'capacity-protocol': 'phase1', 'capacity-protocol-phase-2': 'phase2', 'capacity-protocol-phase-3': 'phase3',
  'capacity-protocol-phases-2-3': 'phase23', 'capacity-protocol-phases-1-2-3': 'phase123',
  '30-minute-coaching': 'coaching30', '30-minute-coaching-5': 'coaching30', '30-minute-coaching-6-months': 'coaching30', '30-minute-coaching-phases-2-3': 'coaching30',
  '60-minute-coaching': 'coaching60', '60-minute-coaching-5': 'coaching60', '60-minute-coaching-6-months': 'coaching60', '60-minute-coaching-phases-2-3': 'coaching60',
  '15-minute-coaching-session': 'coaching_other', 'Eleven 60 Minute Coaching sessions': 'coaching60', 'Weekly 30 Minute Coaching, 6 Months': 'coaching30',
  'clarity-protocol': 'clarity', 'fresh-air-app': 'leadgen', 'capacity-assessment': 'leadgen', 'wnwhp': 'leadgen',
}
for (const [slug, k] of Object.entries(kinds)) eq(`kind of ${slug}`, C.productKind(slug), k)
eq('Phase 1 is covered by the 1-2-3 bundle', ['phase1', 'phase123', 'phase2'].map(C.coversPhase1), [true, true, false])
eq('Phase 2/3 coverage', ['phase2', 'phase3', 'phase23', 'phase123', 'phase1', 'coaching30'].map(C.coversPhase23), [true, true, true, true, false, false])
eq('core is phases and coaching', ['phase1', 'coaching60', 'leadgen', 'clarity'].map(C.isCore), [true, true, false, false])
const split = C.allocate(608200, [{ slug: 'capacity-protocol-phase-2', kind: 'phase2', list: 179700 }, { slug: 'capacity-protocol-phase-3', kind: 'phase3', list: 129700 }, { slug: '30-minute-coaching-6-months', kind: 'coaching30', list: 325000 }])
eq('a bundle splits by list price and sums to the payment', split.reduce((n, l) => n + l.net, 0), 608200)
eq('the coaching share of a bundle', split[2].net, Math.round(608200 - Math.round(608200 * 179700 / 634400) - Math.round(608200 * 129700 / 634400)))
eq('no list prices: the main line takes it all', C.allocate(5000, [{ slug: 'x', kind: 'leadgen', list: 0 }, { slug: 'y', kind: 'leadgen', list: 0 }]).map(l => l.net), [5000, 0])

// coaching
const cs = (pk, sch) => C.committedSessions(pk, sch).map(x => x.n)
eq('committed: weekly 6-month package shows 5 of 26', cs([{ key: 'six', owed: 26, since: '2026-11-04' }], 0), [5])
eq('committed: less those already scheduled in the window', cs([{ key: 'six', owed: 26, since: '2026-11-04' }], 2), [3])
eq('committed: a single session', cs([{ key: 'one', owed: 1, since: '2026-11-04' }], 0), [1])
eq('committed: never negative', cs([{ key: 'p', owed: 4, since: '2026-11-04' }], 6), [0])
eq('committed: two weekly packages still meet once a week, earliest first',
  C.committedSessions([{ key: 'six', owed: 26, since: '2026-11-05' }, { key: 'p23', owed: 6, since: '2026-11-04' }], 0), [{ key: 'p23', n: 5 }, { key: 'six', n: 0 }])
eq('committed: a 3-session package then the next one', cs([{ key: 'a', owed: 3, since: '2026-11-01' }, { key: 'b', owed: 26, since: '2026-11-02' }], 0), [3, 2])
eq('coaching lengths', [60, 50, 30, 15].map(C.coachingLength), [60, 30, 30, 15])

fs.rmSync(out, { recursive: true, force: true })
console.log(fail ? `metrics-check FAIL ${fail}/${total}` : `metrics-check PASS ${total}/${total}`)
process.exit(fail ? 1 : 0)
