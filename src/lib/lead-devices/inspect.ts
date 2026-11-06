// src/lib/lead-devices/inspect.ts
// What the uploader checks in a file. Ported and cut down from the University platform at 9bb18cba
// (src/lib/assessments/inspect-artefact.ts). Pure, so the page and the upload route read a file the same way.
export const MAX_DEVICE_BYTES = 2 * 1024 * 1024

export interface Finding { id: string; severity: 'blocking' | 'quality'; title: string; line: number | null }
export interface DeviceInspection {
  findings: Finding[]
  cannotSubmit: boolean
  detected: { title: string | null; questionIds: string[]; submitStyle: 'npu_bridge' | 'postmessage' | 'both' | 'none'; externalScripts: string[] }
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length

function stripComments(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

export function inspectDevice(html: string): DeviceInspection {
  const findings: Finding[] = []
  const code = stripComments(html)
  const usesBridge = /\bNPU\s*\.\s*submit\s*\(/.test(code)
  const usesPostMessage = /\.\s*postMessage\s*\(/.test(code)
  const submitStyle = usesBridge && usesPostMessage ? 'both' : usesBridge ? 'npu_bridge' : usesPostMessage ? 'postmessage' : 'none'

  if (submitStyle === 'none') {
    findings.push({ id: 'no_submit', severity: 'blocking', title: 'The file never calls window.NPU.submit, so it cannot hand over any answers.', line: null })
  }
  const network = /\bfetch\s*\(|XMLHttpRequest|sendBeacon/.exec(code)
  if (network) {
    findings.push({ id: 'network_call', severity: 'blocking', title: 'The file makes its own network request. The page blocks this, so it would silently fail. Hand results over with window.NPU.submit.', line: lineOf(code, network.index) })
  }
  const identity = /<input[^>]*type\s*=\s*["'](?:email|tel)["']/i.exec(code)
  if (identity) {
    findings.push({ id: 'collects_identity', severity: 'blocking', title: 'The file asks for an email or phone number itself. Files never collect identity: the Hub lead form does that after the file finishes.', line: lineOf(code, identity.index) })
  }
  const ls = /localStorage|sessionStorage/.exec(code)
  if (ls) {
    findings.push({ id: 'browser_storage', severity: 'blocking', title: 'The file uses browser storage. The frame has no origin, so this throws. Keep answers in memory.', line: lineOf(code, ls.index) })
  }
  const form = /<form[\s>]/i.exec(code)
  if (form && !code.includes('preventDefault')) {
    findings.push({ id: 'form_without_prevent_default', severity: 'quality', title: 'A form with no preventDefault navigates away and loses the answers when someone presses Enter.', line: lineOf(code, form.index) })
  }

  const externalScripts = Array.from(new Set(Array.from(code.matchAll(/<script[^>]*\ssrc\s*=\s*["'](https?:\/\/[^"'/]+)/gi)).map((m) => m[1].toLowerCase())))
  const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)
  const questionIds = Array.from(new Set(Array.from(html.matchAll(/answers\[\s*["'](\w+)["']\s*\]/g)).map((m) => m[1])))

  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1))
  return {
    findings,
    cannotSubmit: findings.some((f) => f.severity === 'blocking'),
    detected: { title: title ? title[1].trim() : null, questionIds, submitStyle, externalScripts },
  }
}

/** The optional manifest block in a file, used to prefill the upload form. Null when absent or unreadable. */
export function readManifestBlock(html: string): Record<string, unknown> | null {
  const m = /<script[^>]*id\s*=\s*["']np-device["'][^>]*>([\s\S]*?)<\/script>/i.exec(html)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1])
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
