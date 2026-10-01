// src/lib/agent/untrusted.ts
// Ruling 6: text a person pastes, and text read back from the Hub that people wrote (existing
// message copy, form wording), reaches the model only inside a labelled block that the system
// prompt says is data to read, never instructions (AG11). A closing tag inside the text is
// neutralised so pasted text cannot end the block early and speak as the operator.

export function wrapUntrusted(source: string, text: string): string {
  const safeSource = source.replace(/[^a-z0-9_ -]/gi, '').slice(0, 40) || 'unknown'
  const body = String(text ?? '').replace(/<\s*\/?\s*untrusted_input[^>]*>/gi, '[tag removed]')
  return `<untrusted_input source="${safeSource}">\n${body}\n</untrusted_input>`
}

/**
 * The superadmin's own request is the task, not data, so it is NOT an untrusted block (ruling 6
 * covers pasted text and text read back from the Hub). It still cannot open or close any block,
 * so it can never pose as setup, existing copy or pasted material.
 */
export function wrapRequest(text: string): string {
  const body = String(text ?? '').replace(/<\s*\/?\s*(untrusted_input|request)[^>]*>/gi, '[tag removed]')
  return `<request>\n${body}\n</request>`
}

/** Email addresses and phone numbers replaced before a question is sent or stored (AG25). */
export function scrubContactDetails(text: string): string {
  return String(text ?? '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/(\+?\d[\d\s().-]{7,}\d)/g, '[phone]')
}
