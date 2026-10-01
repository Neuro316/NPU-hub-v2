// Help copy for the Funnels screens, in one place so the wording stays consistent.
// Plain, complete sentences; no jargon.
import { InfoTip } from './info-tip'

export const HELP = {
  section: 'Each part of this page describes one piece of the campaign. Change it here and save; the change applies to people who enter from now on.',
  status: 'Draft campaigns do nothing. Active campaigns take in new people and run their steps. Paused campaigns hold everyone where they are, and archived campaigns are put away.',
  pipeline: 'The pipeline this campaign places people in, so you can see where they are on your board.',
  entry: 'The stage a person is placed in the moment they enter the campaign.',
  goal: 'When a person reaches this stage, the campaign has done its job, so it stops sending them its messages.',
  startsFrom: 'The events that bring a person into this campaign, such as submitting a form. One person is only ever entered once for the same event.',
  steps: 'The messages people receive, in order. Each one waits for its delay after the previous one.',
  channel: 'Email or a text message. A wait step sends nothing and only adds time before the next step.',
  sendAfter: 'How many hours to wait after the previous step, or after the person enters for the first step. Zero means right away.',
  kind: 'Marketing messages only go to people who agreed to hear from you on that channel. Service messages, such as confirmations and reminders, need only their agreement to service messages. A step left unlabelled is treated as marketing, the stricter rule.',
  whatItDoes: 'Send a message, or deliver a free University resource as a private link that expires after two weeks.',
  preview: 'Shows the message as a person would see it, with a sample name. Nothing is sent.',
  testDrive: 'Puts your own test contact into this campaign through the real engine. Within five minutes the first step runs, and while live sending is off it is a dry run: the Hub records what it would have sent and sends nothing. The campaign must be Active.',
  live: 'When this is on, people who agreed to hear from you receive real messages. When it is off, only your test contacts can receive real messages, and everyone else gets a dry run. Only a platform superadmin can turn it on.',
  sending: 'Every message is checked first for agreement, do not contact, quiet hours and how many marketing messages the person had recently. The reason for each decision is recorded.',
}

export function Help({ topic, k, wide }: { topic: string; k: keyof typeof HELP; wide?: boolean }) {
  return <InfoTip topic={topic} wide={wide}><p>{HELP[k]}</p></InfoTip>
}

export function HowItWorks() {
  return (
    <InfoTip topic="how a funnel campaign works" wide>
      <p className="font-semibold text-np-dark">How a funnel campaign works</p>
      <ol className="list-decimal space-y-1 pl-4">
        <li><b>Something happens.</b> A person submits a form, books, or another event you chose under Starts from.</li>
        <li><b>They enter the campaign.</b> The Hub enters them once for that event, even if it arrives twice.</li>
        <li><b>They are placed in a stage.</b> The campaign puts them in its entry stage on your pipeline.</li>
        <li><b>The steps run.</b> Each message waits for its delay and then goes out.</li>
        <li><b>Every message is checked first.</b> The Hub confirms they agreed to that kind of message, are not marked do not contact, are inside their quiet hours, and have not had too many marketing messages recently. Until live sending is on, it records what it would have sent and sends nothing.</li>
        <li><b>They reach the goal.</b> When they move into the goal stage, the campaign stops sending them its messages.</li>
      </ol>
    </InfoTip>
  )
}
