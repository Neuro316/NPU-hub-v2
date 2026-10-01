// src/lib/marketing/ui-logic.ts
// Pure helpers for the Funnels screens: friendly entry sources and the keys they map to,
// plain-language reasons for send decisions, the readiness checklist, and the starter
// message templates. No I/O, so scripts/marketing/pure-tamper.cjs can test them.

export type SourceKind = 'form' | 'call_missed' | 'call_inbound' | 'booking' | 'tag' | 'stage' | 'quiz' | 'import'

export const SOURCE_KINDS: Array<{ kind: SourceKind; label: string; needs: 'form' | 'text' | 'stage' | null; ask?: string }> = [
  { kind: 'form', label: 'Someone submits a form you built', needs: 'form' },
  { kind: 'call_missed', label: 'Someone calls and the call is missed', needs: null },
  { kind: 'call_inbound', label: 'Someone calls and the call is answered', needs: null },
  { kind: 'booking', label: 'Someone books a session', needs: 'text', ask: 'Which kind of booking, for example intro call' },
  { kind: 'tag', label: 'A tag is added to a contact', needs: 'text', ask: 'Which tag' },
  { kind: 'stage', label: 'A contact moves into a pipeline stage', needs: 'stage' },
  { kind: 'quiz', label: 'Someone completes a quiz', needs: 'text', ask: 'Which quiz, for example nervous system check' },
  { kind: 'import', label: 'Contacts are imported', needs: 'text', ask: 'A name for the import, for example spring workshop list' },
]

export function slugPart(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)
}

/** The source key a friendly choice produces, or null when the choice is incomplete. */
export function sourceKeyFor(kind: SourceKind, detail: string): string | null {
  switch (kind) {
    case 'call_missed': return 'call:missed'
    case 'call_inbound': return 'call:answered'
    case 'form': return detail && /^[a-z0-9][a-z0-9_.:-]{0,79}$/.test(detail) ? detail : null
    case 'stage': return /^[0-9a-f-]{36}$/.test(detail) ? `stage:${detail}` : null
    default: {
      const p = slugPart(detail)
      return p ? `${kind}:${p}` : null
    }
  }
}

// ── which starting points actually raise events ──
// Built on the server from the real state (the hub_212 triggers and queue in the
// database, the phone lines in CRM Settings) by buildSourceStatus, and sent with the
// overview. Forms and test drives are wired in code that always ships with this page.
export type SourceGroup = 'form' | 'manual' | 'call_missed' | 'call_answered' | 'booking' | 'tag' | 'stage' | 'quiz' | 'import'
export interface SourceState { connected: boolean; why: string }
export type SourceStatus = Partial<Record<SourceGroup, SourceState>>

export function sourceGroup(key: string): SourceGroup | null {
  if (key === 'call:missed') return 'call_missed'
  if (key === 'call:answered' || key === 'call:inbound') return 'call_answered'
  const kind = key.split(':')[0]
  return (['form', 'manual', 'booking', 'tag', 'stage', 'quiz', 'import'] as const).find((k) => k === kind) ?? null
}

/** The group a picker choice belongs to, without needing its detail filled in. */
export function kindGroup(kind: SourceKind): SourceGroup {
  return kind === 'call_inbound' ? 'call_answered' : kind
}

export function buildSourceStatus(i: { queue: boolean; stageTrigger: boolean; tagTrigger: boolean; lines: number }): SourceStatus {
  const noQueue = 'The campaign event queue is not installed in the database yet.'
  const call = !i.queue ? { connected: false, why: noQueue }
    : i.lines < 1 ? { connected: false, why: 'No phone line is set up in CRM Settings, Twilio.' }
    : { connected: true, why: `Raised by calls to your ${i.lines} phone ${i.lines === 1 ? 'line' : 'lines'}.` }
  const nothing = { connected: false, why: 'Nothing in the Hub raises this event yet.' }
  return {
    form: { connected: true, why: 'Raised when someone submits a published form.' },
    manual: { connected: true, why: 'Raised by a test drive.' },
    call_missed: call,
    call_answered: call,
    stage: !i.queue ? { connected: false, why: noQueue } : i.stageTrigger ? { connected: true, why: 'Raised when a contact moves into the stage, from any screen.' } : { connected: false, why: 'The stage change trigger is not installed in the database.' },
    tag: !i.queue ? { connected: false, why: noQueue } : i.tagTrigger ? { connected: true, why: 'Raised when the tag is added to a contact, from any screen.' } : { connected: false, why: 'The tag trigger is not installed in the database.' },
    import: !i.queue ? { connected: false, why: noQueue } : { connected: true, why: 'Raised only when the person importing ticks Start funnel campaigns and uses this import name.' },
    booking: nothing,
    quiz: nothing,
  }
}

export function sourceIsConnected(key: string, status?: SourceStatus): boolean {
  const g = sourceGroup(key)
  return !!g && status?.[g]?.connected === true
}

/** Why a starting point will not fire yet, or null when it is connected. */
export function sourceGapText(key: string, status?: SourceStatus): string | null {
  if (sourceIsConnected(key, status)) return null
  const g = sourceGroup(key)
  return (g && status?.[g]?.why) || 'Nothing in the Hub raises this event yet.'
}

export function describeSource(key: string, forms: Array<{ source_key: string; name: string }>, stages: Array<{ id: string; name: string }>): string {
  const f = forms.find((x) => x.source_key === key)
  if (f) return `Someone submits the form "${f.name}"`
  if (key === 'call:missed') return 'A missed call'
  if (key === 'call:inbound' || key === 'call:answered') return 'An answered call'
  const [kind, rest] = [key.split(':')[0], key.slice(key.indexOf(':') + 1)]
  const nice = rest.replace(/-/g, ' ')
  if (kind === 'stage') return `Moves into the stage "${stages.find((s) => s.id === rest)?.name ?? 'unknown stage'}"`
  if (kind === 'booking') return `Books a ${nice} session`
  if (kind === 'tag') return `Gets the tag "${nice}"`
  if (kind === 'quiz') return `Completes the ${nice} quiz`
  if (kind === 'import') return `Imported in "${nice}"`
  if (kind === 'form') return `A form with the address ${rest}`
  return key
}

// ── send decisions in plain language ──
const REASONS: Record<string, string> = {
  passed: 'Every check passed.',
  engine_off: 'The campaign engine is switched off for this organization, so nothing runs. A superadmin can turn it on in CRM Settings, Campaign Sending.',
  no_valid_email: 'This person has no usable email address on file.',
  no_valid_e164_phone: 'This person has no usable mobile number on file. Numbers need the full international form, like +18285550100.',
  no_marketing_consent: 'This person has not agreed to marketing on this channel. Marketing messages need their recorded agreement, from a form or a note in their Consent tab.',
  marketing_revoked: 'This person withdrew their agreement to marketing on this channel, so they are not sent marketing.',
  no_service_basis: 'There is no record that this person agreed to service messages on this channel. Record one in their Consent tab if they did.',
  service_revoked: 'This person withdrew their agreement to messages on this channel, for example by replying STOP.',
  do_not_contact_flag: 'This contact is marked do not contact.',
  do_not_contact_list: 'This address is on the do not contact list.',
  outside_send_window: 'It is outside the hours messages may go out in this person\'s time zone, so the message waits until the window opens.',
  cap_reached: 'This person has already had the most marketing messages allowed for now, so this one is held back to protect them from too many.',
  campaign_not_draft: 'The campaign is still a draft. A test drive only runs on an active campaign; set the status to Active first.',
  campaign_not_paused: 'The campaign is paused. Set it back to Active to run a test drive.',
  campaign_not_archived: 'The campaign is archived. Set it back to Active to run a test drive.',
  already_active: 'Your test contact is already partway through this campaign, so nothing new started. Their earlier run continues.',
  duplicate_event: 'This exact event was already counted once, so it did not start the campaign again.',
  sms_too_long: 'The text message is too long once the name and the opt out line are added. Shorten it.',
  provider_email_off: 'Email sending through Resend is switched off, so the email was not sent.',
  provider_sms_off: 'Text messaging through Twilio is switched off, so the text was not sent.',
  sender_is_placeholder: 'No sending address is set yet, so no email can go out. Set one in CRM Settings, Campaign Sending.',
  unsubscribe_secret_missing: 'The unsubscribe link cannot be made yet, so no marketing email can go out.',
  outcome_unknown: 'The message may or may not have gone out, so it is not tried again, to avoid sending it twice.',
}

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return 'No reason was recorded.'
  if (REASONS[reason]) return REASONS[reason]
  if (reason.startsWith('suppressed_')) return 'This address has opted out or bounced before, so nothing is sent to it.'
  if (reason.endsWith('_granted')) return REASONS.passed
  return `The Hub recorded the reason "${reason.replace(/_/g, ' ')}".`
}

// ── readiness ──
export interface ReadyStep { channel: string; kind: string | null; step_type?: string }
export interface ReadyInput {
  senderProblem: string | null
  unsubscribeReady: boolean
  steps: ReadyStep[]
  routeKeys: string[]
  forms: Array<{ id?: string; source_key: string; name: string; status: string; consents: any[] }>
  previewed: number[]
  testDriveDone: boolean
}
export interface ReadyItem { id: string; label: string; ok: boolean; detail: string; fix: 'settings' | 'forms' | 'messages' | 'test' | null; formId?: string }

export function readiness(i: ReadyInput): ReadyItem[] {
  const msgs = i.steps.map((s, idx) => ({ ...s, idx })).filter((s) => s.channel === 'email' || s.channel === 'sms')
  const emails = msgs.filter((s) => s.channel === 'email')
  const marketingEmail = emails.some((s) => (s.kind ?? 'marketing') === 'marketing')
  const feeding = i.forms.filter((f) => i.routeKeys.includes(f.source_key))
  const badForm = feeding.find((f) => f.status !== 'published' || !(f.consents?.length) || f.consents.some((c: any) => !String(c?.text ?? '').trim()))
  const unpreviewed = msgs.filter((s) => !i.previewed.includes(s.idx))
  return [
    { id: 'messages', label: 'The campaign has at least one message', ok: msgs.length > 0,
      detail: msgs.length ? `${msgs.length} message ${msgs.length === 1 ? 'step' : 'steps'}.` : 'Add a message step.', fix: msgs.length ? null : 'messages' },
    { id: 'sender', label: 'A sending address is set for email', ok: !emails.length || !i.senderProblem,
      detail: !emails.length ? 'There are no email steps, so no sending address is needed.' : i.senderProblem ? reasonText(i.senderProblem) : 'The sending address is set.', fix: emails.length && i.senderProblem ? 'settings' : null },
    { id: 'optout', label: 'Every marketing message can be opted out of', ok: !marketingEmail || i.unsubscribeReady,
      detail: marketingEmail && !i.unsubscribeReady ? 'Marketing emails need the unsubscribe secret set in the Hub\'s environment (HUB_UNSUBSCRIBE_SECRET). Marketing texts always carry a STOP line.' : 'Marketing emails carry an unsubscribe link and marketing texts carry a STOP line.', fix: marketingEmail && !i.unsubscribeReady ? 'settings' : null },
    { id: 'consent', label: 'Every form that starts this campaign is published and shows its consent wording', ok: !badForm,
      detail: !feeding.length ? 'No form starts this campaign.' : badForm ? `The form "${badForm.name}" is not published or has a consent box without wording.` : 'Every feeding form is published with its consent wording.', fix: badForm ? 'forms' : null, formId: badForm?.id },
    { id: 'previews', label: 'Every message has been previewed', ok: msgs.length > 0 && unpreviewed.length === 0,
      detail: unpreviewed.length ? `Preview ${unpreviewed.map((s) => `step ${s.idx + 1}`).join(', ')}.` : 'All messages previewed.', fix: unpreviewed.length ? 'messages' : null },
    { id: 'test', label: 'A test drive has been run', ok: i.testDriveDone, detail: i.testDriveDone ? 'A test drive ran.' : 'Run a test drive with your test contact.', fix: i.testDriveDone ? null : 'test' },
  ]
}

// ── starter templates ──
export type Template = 'welcome' | 'nurture' | 'reminder' | 'asset'
export const TEMPLATES: Record<Template, { label: string; why: string; step: { channel: 'email' | 'sms'; kind: 'marketing' | 'service'; step_type: 'message' | 'deliver_asset'; delay_minutes: number; subject: string | null; body: string } }> = {
  welcome: { label: 'Welcome message', why: 'Sent right away to say hello. It is marketing, so it goes only to people who agreed to hear from you.',
    step: { channel: 'email', kind: 'marketing', step_type: 'message', delay_minutes: 0, subject: 'Welcome, {{first_name}}',
      body: 'Hi {{first_name}},\n\nThank you for joining us. Over the next few days we will share short practices that help your nervous system build range and recover with more ease.\n\nWith care,\n{{org_name}}' } },
  nurture: { label: 'Nurture follow-up', why: 'A helpful idea a couple of days later. It is marketing.',
    step: { channel: 'email', kind: 'marketing', step_type: 'message', delay_minutes: 2 * 24 * 60, subject: 'One small practice for this week',
      body: 'Hi {{first_name}},\n\nBy the end of this week, try noticing three moments when your body shifts gears. There is nothing to fix. Each one is your nervous system doing its job.\n\n{{org_name}}' } },
  reminder: { label: 'Reminder', why: 'A short text before something they signed up for. It is a service message, so it needs only their agreement to service texts.',
    step: { channel: 'sms', kind: 'service', step_type: 'message', delay_minutes: 60,
      subject: null, body: 'Hi {{first_name}}, this is a reminder from {{org_name}} about your upcoming session. Reply to this text if you need to change it.' } },
  asset: { label: 'University asset delivery', why: 'Sends the free resource they asked for, with a private link that expires. It is a service message because they requested it.',
    step: { channel: 'email', kind: 'service', step_type: 'deliver_asset', delay_minutes: 0, subject: 'Your free resource is ready',
      body: 'Hi {{first_name}},\n\nHere is the resource you asked for: {{asset_link}}\n\nThe link is private to you and works for two weeks.\n\n{{org_name}}' } },
}
