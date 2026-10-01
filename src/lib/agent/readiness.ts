// src/lib/agent/readiness.ts
// Phase 2: the follow-up tasks a draft always needs, added by the server whatever the model
// did, so the list a person sees never depends on the model remembering. Pure: the plan and
// the setup in, tasks out. Each task names exactly what to do.
import type { HubSetup } from './tools/read'
import type { Plan, PlanTask } from './tools/draft'
import { MAX_TASKS } from './tools/draft'

export function followUps(plan: Plan, setup: HubSetup): PlanTask[] {
  const out: PlanTask[] = []
  const steps = plan.sequence?.steps ?? []
  const messages = steps.filter((s) => s.channel !== 'wait')

  if (messages.length) {
    const flagged = plan.review.map((r) => `Step ${r.step}: ${r.issues.join(' ')}`)
    out.push({ kind: 'copy_review', title: 'Read and approve the drafted messages',
      detail: ['Every message was written by the Campaign Builder and is marked AI draft until a person edits or approves it.',
        flagged.length ? `The claims check flagged: ${flagged.join(' ')}` : ''].filter(Boolean).join(' ') })
  } else if (plan.campaign) {
    out.push({ kind: 'copy_review', title: 'Write the campaign\'s messages', detail: 'The draft has no messages yet.' })
  }

  if (plan.campaign && !plan.routes.length) {
    out.push({ kind: 'connect_source', title: 'Choose what starts this campaign', detail: 'The draft has no entry source, so nobody can enter it until one is added.' })
  }
  for (const r of plan.routes) {
    if (!r.source_key.startsWith('form:')) continue
    const live = setup.forms.find((f) => f.source_key === r.source_key)
    const drafted = plan.forms.find((f) => f.source_key === r.source_key)
    if ((live && live.status !== 'published') || drafted) {
      out.push({ kind: 'connect_source', title: `Publish the form ${(live?.name ?? drafted?.name) || r.source_key}`,
        detail: 'The campaign starts when this form is submitted, and only a published form accepts submissions.' })
    }
  }

  if (messages.some((s) => s.channel === 'email') && !setup.sender_ready) {
    out.push({ kind: 'sender_or_dns', title: 'Set the sending address', detail: 'No sending address is set, so no campaign email can go out. Set one in CRM Settings, Campaign Sending, using a subdomain verified in Resend.' })
  }

  // marketing messages need recorded marketing consent on that channel; a form route must ask for it
  for (const ch of ['email', 'sms'] as const) {
    if (!messages.some((s) => s.channel === ch && s.kind === 'marketing')) continue
    const formKeys = plan.routes.map((r) => r.source_key).filter((k) => k.startsWith('form:'))
    const asks = formKeys.some((k) => {
      const consents = setup.forms.find((f) => f.source_key === k)?.consents ?? (plan.forms.find((f) => f.source_key === k)?.consents as any[] ?? [])
      return consents.some((c: any) => c.channel === ch && c.kind === 'marketing')
    })
    if (!asks) {
      out.push({ kind: 'consent', title: `Make sure people agree to marketing ${ch === 'sms' ? 'texts' : 'emails'}`,
        detail: `This campaign sends marketing ${ch === 'sms' ? 'texts' : 'emails'}, which only reach people who agreed to them. Add a marketing consent box for ${ch === 'sms' ? 'text messages' : 'email'} to the form that starts it, or change those steps to service messages if that is what they are.` })
    }
  }

  if (messages.some((s) => s.channel === 'sms')) {
    out.push({ kind: 'sms_registration', title: 'Confirm the SMS registration covers these texts',
      detail: 'Check that the A2P 10DLC campaign registered for this number covers the kind of texts in this draft before switching it on.' })
  }

  // never more than the cap, and never a duplicate of a task the model already added
  const merged = [...plan.tasks]
  for (const t of out) {
    if (merged.length >= MAX_TASKS) break
    if (!merged.some((m) => m.title.trim().toLowerCase() === t.title.trim().toLowerCase())) merged.push(t)
  }
  return merged
}
