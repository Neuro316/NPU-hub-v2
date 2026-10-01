// src/lib/click-to-call/signature.ts
// The pure half of the click-to-call webhook check, kept apart from the database so
// scripts/click-to-call/c2c-tamper.cjs can prove that a missing, empty or wrong
// signature is refused. Imports validateRequest directly, not lib/twilio.ts, which
// builds a client at module scope.
import { validateRequest } from 'twilio'

export function signatureOk(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  if (!authToken || !url || !signature) return false
  try {
    return validateRequest(authToken, signature, url, params)
  } catch {
    return false
  }
}
