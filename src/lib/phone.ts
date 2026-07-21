// src/lib/phone.ts
// Shared phone-number normalization. Extracted verbatim from
// api/twilio/inbound-call/route.ts so the voicemail-greeting settings panel and
// any future caller-ID handling use ONE implementation — a second inline copy
// drifting from this one is how the original browser-call bug got shipped.

/**
 * Normalize a stored contact phone (which may be "(828) 348-4022",
 * "270-358-6842", "(828) 505-7222 ext. 104", etc.) to E.164 for
 * <Dial><Number>. Returns '' if the value is not a dialable number
 * (e.g. "Test"), so the caller can reject instead of misrouting. This is the
 * crux of the browser-call bug: a formatted number failed the old
 * /^\+?\d{7,15}$/ test and fell through to the <Client> branch.
 */
export function toE164(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();
  if (trimmed.toLowerCase().startsWith('client:')) return '';
  // Drop trailing extensions ("ext. 104", "x104") — Twilio can't dial them inline.
  const withoutExt = trimmed.replace(/\s*(?:ext\.?|x)\s*\d+\s*$/i, '');
  const hasPlus = withoutExt.trim().startsWith('+');
  const digits = withoutExt.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;               // US 10-digit
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`; // US 1+10
  if (digits.length >= 7) return `+${digits}`;                  // best-effort international
  return '';
}

/** Display helper: +18284155050 -> (828) 415-5050; passes anything else through. */
export function formatUsPhone(e164: string): string {
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec((e164 || '').trim());
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : (e164 || '');
}
