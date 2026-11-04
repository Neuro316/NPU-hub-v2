// node scripts/bookings/placement-check.mjs
// Checks the booking sync's pure rules (src/lib/bookings/placement.ts): stage placement,
// never backward, other pipelines left alone, and the answers as shown on the card.
import { decidePlacement, answerList } from '../../src/lib/bookings/placement.ts'

const pipes = [
  { id: 'sales', name: 'Sales', stages: [{ name: 'New Lead' }, { name: 'Discovery Call Booked' }, { name: 'Discovery Call' }, { name: 'Won', is_closed_won: true }] },
  { id: 'other', name: 'Other', stages: [{ name: 'A' }] },
]
const route = { pipeline_id: 'sales', stage_name: 'discovery call booked', move_earlier_stages_only: true }
const cases = [
  ['no pipeline enters', { pipeline_id: null, pipeline_stage: null }, route, 'entered', 'Discovery Call Booked'],
  ['deleted pipeline enters', { pipeline_id: 'gone', pipeline_stage: 'X' }, route, 'entered', 'Discovery Call Booked'],
  ['other live pipeline is left', { pipeline_id: 'other', pipeline_stage: 'A' }, route, 'other_pipeline', undefined],
  ['earlier stage moves forward', { pipeline_id: 'sales', pipeline_stage: 'New Lead' }, route, 'moved', 'Discovery Call Booked'],
  ['same stage is kept', { pipeline_id: 'sales', pipeline_stage: 'Discovery Call Booked' }, route, 'kept', undefined],
  ['later stage is kept (never backward)', { pipeline_id: 'sales', pipeline_stage: 'Discovery Call' }, route, 'kept', undefined],
  ['won is kept', { pipeline_id: 'sales', pipeline_stage: 'Won' }, route, 'kept', undefined],
  ['backward allowed when the switch is off', { pipeline_id: 'sales', pipeline_stage: 'Won' }, { ...route, move_earlier_stages_only: false }, 'moved', 'Discovery Call Booked'],
  ['unknown stage name in pipeline moves', { pipeline_id: 'sales', pipeline_stage: 'Renamed' }, route, 'moved', 'Discovery Call Booked'],
  ['missing route stage places nothing', { pipeline_id: null, pipeline_stage: null }, { ...route, stage_name: 'Nope' }, 'none', undefined],
  ['missing route pipeline places nothing', { pipeline_id: null, pipeline_stage: null }, { ...route, pipeline_id: 'gone' }, 'none', undefined],
]
let fail = 0
for (const [name, contact, r, want, stage] of cases) {
  const got = decidePlacement(pipes, r, contact)
  if (got.placement !== want || got.stage !== stage) { fail++; console.log(`FAIL ${name}: want ${want}/${stage} got ${got.placement}/${got.stage}`) }
}
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
