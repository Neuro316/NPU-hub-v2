// src/lib/marketing/providers/twilio-sms.ts
// SMS through the existing org Twilio path, pinned to the Primary line: it is the
// only sender registered to the A2P campaign (the WNW Office line fails with 30034),
// the same rule src/lib/notify-sms.ts follows. One part only: a campaign text longer
// than one part is an authoring error, refused rather than split.
import { createAdminSupabase } from '@/lib/supabase'
import { getOrgTwilioConfig, sendOrgSms } from '@/lib/twilio-org'
import { toE164 } from '@/lib/phone'
import { SMS_PART_MAX } from '@/lib/sms-split'
import type { ProviderResult, SmsMessage, SmsProvider } from './types'

const PRIMARY_NICKNAME = 'Primary'

export const twilioSmsProvider: SmsProvider = {
  name: 'twilio',
  async send(msg: SmsMessage): Promise<ProviderResult> {
    if (msg.body.length > SMS_PART_MAX) return { ok: false, provider: 'twilio', permanent: true, ambiguous: false, code: 'sms_too_long' }
    const config = await getOrgTwilioConfig(createAdminSupabase(), msg.orgId)
    if (!config.account_sid) return { ok: false, provider: 'twilio', permanent: false, ambiguous: false, code: 'twilio_not_configured' }
    const primary = toE164(config.numbers.find((x) => x.nickname === PRIMARY_NICKNAME)?.phone || '')
    if (!primary) return { ok: false, provider: 'twilio', permanent: false, ambiguous: false, code: 'no_primary_line' }
    try {
      const m: any = await sendOrgSms(config, msg.to, msg.body, 'campaign', null, { from: primary })
      return { ok: true, provider: 'twilio', externalId: String(m.sid) }
    } catch (e: any) {
      const status = Number(e?.status) || 0
      const permanent = status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 429
      console.error(`[twilio-sms] send=${msg.sendId} status=${status || 'network'} code=${e?.code ?? '-'}`)
      return { ok: false, provider: 'twilio', permanent, ambiguous: status === 0 || status >= 500, code: `twilio_${status || 'network'}${e?.code ? `_${e.code}` : ''}` }
    }
  },
}
