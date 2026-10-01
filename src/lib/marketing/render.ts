// src/lib/marketing/render.ts
// Pure rendering of one campaign step for one contact. No I/O, so the harness can
// assert exactly what a person would receive, and a dry run stores the same text a
// live send would have used.
import { resolveMergeTags } from '@/lib/crm-server'
import type { CrmContact } from '@/types/crm'

export interface RenderInput {
  channel: 'email' | 'sms'
  kind: 'marketing' | 'service'
  subject: string | null
  body: string
  contact: Pick<CrmContact, 'first_name' | 'last_name' | 'email' | 'phone' | 'pipeline_stage'>
  orgName: string
  unsubscribeUrl: string | null
  assetUrl: string | null
}

export interface Rendered { subject: string; html: string; text: string }

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))

export function htmlToText(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n').trim()
}

export const SMS_STOP_LINE = 'Reply STOP to opt out.'

export function renderStep(i: RenderInput): Rendered {
  // asset link first, so a template that names it gets it in place and one that
  // does not gets it appended
  // The TEMPLATE is staff-written and trusted; merge VALUES can come from a public form,
  // so they are escaped before they enter HTML, and nothing about the template's own
  // wording (HTML or not, carries a STOP line or not) is judged after values are merged.
  let template = i.body || ''
  if (i.assetUrl) {
    template = template.includes('{{asset_link}}') ? template.split('{{asset_link}}').join(i.assetUrl) : `${template}\n\n${i.assetUrl}`
  }
  const c = i.contact as CrmContact
  const plain = resolveMergeTags(template, c, i.orgName)
  const subject = resolveMergeTags(i.subject || '', c, i.orgName).trim()

  if (i.channel === 'sms') {
    let text = htmlToText(plain)
    if (i.kind === 'marketing' && !/reply stop/i.test(template)) text = `${text} ${SMS_STOP_LINE}`
    return { subject: '', html: '', text: text.trim() }
  }

  const looksHtml = /<[a-z][\s\S]*>/i.test(template)
  const escaped = {
    first_name: escapeHtml(c.first_name || ''), last_name: escapeHtml(c.last_name || ''), email: escapeHtml(c.email || ''),
    phone: escapeHtml(c.phone || ''), pipeline_stage: escapeHtml(c.pipeline_stage || ''),
  } as CrmContact
  let html = looksHtml
    ? resolveMergeTags(template, escaped, escapeHtml(i.orgName))
    : plain.split(/\n{2,}/).map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')
  let text = looksHtml ? htmlToText(plain) : plain
  if (i.kind === 'marketing') {
    const why = `You are receiving this because you asked to hear from ${escapeHtml(i.orgName)}.`
    const link = i.unsubscribeUrl
      ? `<a href="${escapeHtml(i.unsubscribeUrl)}">Unsubscribe from these emails</a>`
      : '[the unsubscribe link is added when this email is sent]'
    html += `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:12px;color:#6b7280">${why} ${link}</p>`
    text += `\n\n${why.replace(/&amp;/g, '&')} Unsubscribe: ${i.unsubscribeUrl ?? '[added when sent]'}`
  }
  return { subject, html, text: text.trim() }
}
