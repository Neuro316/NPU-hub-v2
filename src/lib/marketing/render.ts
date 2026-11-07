// src/lib/marketing/render.ts
// Pure rendering of one campaign step for one contact. No I/O, so the harness can
// assert exactly what a person would receive, and a dry run stores the same text a
// live send would have used.
import { resolveMergeTags, type MergeContact } from '@/lib/crm-server'
import type { CrmContact } from '@/types/crm'

export interface RenderInput {
  channel: 'email' | 'sms'
  kind: 'marketing' | 'service'
  subject: string | null
  body: string
  /** stage_name: the person's stage for {{pipeline_stage}}, from contact_pipeline_positions (see mergeStage) */
  contact: Pick<CrmContact, 'first_name' | 'last_name' | 'email' | 'phone'> & { stage_name?: string | null }
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

/**
 * Pure: the stage {{pipeline_stage}} names. The person's stage in the given pipeline (a campaign's entry pipeline);
 * with no pipeline given, their stage when they are in exactly one pipeline. Otherwise empty: nothing is guessed.
 */
export function mergeStage(positions: Array<{ pipeline_id: string; stage_name: string }>, pipelineId: string | null | undefined): string {
  if (pipelineId) return positions.find((p) => p.pipeline_id === pipelineId)?.stage_name ?? ''
  return positions.length === 1 ? positions[0].stage_name : ''
}

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
  const c = i.contact as MergeContact
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
    phone: escapeHtml(c.phone || ''), stage_name: escapeHtml(c.stage_name || ''),
  } as MergeContact
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
