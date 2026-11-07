// node scripts/bookings/placement-check.mjs
// Checks the booking sync's pure rules (src/lib/bookings/placement.ts): which stage a route
// points at, nothing guessed, what a placement did, and the answers as shown on the card.
// "Never backward" and "other pipelines left alone" are hub_pipeline_place's, in hub_229.
import { routeStage, placementOf, answerList } from '../../src/lib/bookings/placement.ts'

const pipes = [
  { id: 'u-sales', key: 'sales', name: 'Sales', stages: [{ id: 's1', name: 'New Lead' }, { id: 's2', name: 'Discovery Call Booked' }, { id: 's3', name: 'Discovery Call' }] },
  { id: 'u-dup', key: 'dup', name: 'Dup', stages: [{ id: 'd1', name: 'Booked' }, { id: 'd2', name: 'booked' }] },
]
const route = { pipeline_id: 'sales', stage_name: 'discovery call booked' }
const stageOf = (r) => { const t = routeStage(pipes, r); return t.ok ? t.stage.id : t.reason }
const cases = [
  ['legacy key resolves, loose name', stageOf(route), 's2'],
  ['uuid resolves', stageOf({ ...route, pipeline_id: 'u-sales' }), 's2'],
  ['exact name wins', stageOf({ pipeline_id: 'dup', stage_name: 'booked' }), 'd2'],
  ['two loose matches is unknown', stageOf({ pipeline_id: 'dup', stage_name: 'BOOKED' }), 'stage_unknown'],
  ['missing stage places nothing', stageOf({ ...route, stage_name: 'Nope' }), 'stage_unknown'],
  ['missing pipeline places nothing', stageOf({ ...route, pipeline_id: 'gone' }), 'pipeline_unknown'],
  ['added', placementOf({ placed: true, moved: false }), 'entered'],
  ['moved', placementOf({ placed: true, moved: true }), 'moved'],
  ['already there is kept', placementOf({ placed: false, reason: 'already_there' }), 'kept'],
  ['already further is kept', placementOf({ placed: false, reason: 'already_further' }), 'kept'],
  ['unknown stage is none', placementOf({ placed: false, reason: 'stage_unknown' }), 'none'],
]
let fail = 0
for (const [name, got, want] of cases) if (got !== want) { fail++; console.log(`FAIL ${name}: want ${want} got ${got}`) }
const ans = answerList(
  [{ key: 'h', label: 'How did you hear about us?' }, { key: 'w', label: 'What do you want?' }, { key: 'a', label: 'Areas' }],
  { a: ['Sleep', 'Focus'], h: 'Podcast', extra: 'x' },
)
const want = JSON.stringify([
  { key: 'h', label: 'How did you hear about us?', answer: 'Podcast' },
  { key: 'w', label: 'What do you want?', answer: '' },
  { key: 'a', label: 'Areas', answer: 'Sleep, Focus' },
  { key: 'extra', label: 'extra', answer: 'x' },
])
if (JSON.stringify(ans) !== want) { fail++; console.log('FAIL answers', JSON.stringify(ans)) }
if (JSON.stringify(answerList(null, null)) !== '[]') { fail++; console.log('FAIL empty answers') }
const total = cases.length + 2
console.log(fail ? `PLACEMENT_CHECK FAIL ${fail}/${total}` : `PLACEMENT_CHECK PASS ${total}/${total}`)
process.exit(fail ? 1 : 0)
