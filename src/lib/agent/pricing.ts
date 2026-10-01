// src/lib/agent/pricing.ts
// What a model call costs, from the usage the API returns (ruling 8). Prices are US dollars
// per million tokens, from the Claude API price list (2026-09-25). Cache writes are the
// 5-minute rate, 1.25 times input. A model with no price here refuses to run (AG7): a cap
// that cannot be priced cannot be enforced.

export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

export const PRICES: Record<string, Price> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  'claude-haiku-4-5-20251001': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // a refusal fallback can be served by another model; it is priced at that model's rate
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
}

/** The most expensive price in the table, used when the model that served a call is unknown. */
export const CEILING: Price = Object.values(PRICES).reduce((a, p) => ({
  input: Math.max(a.input, p.input), output: Math.max(a.output, p.output),
  cacheRead: Math.max(a.cacheRead, p.cacheRead), cacheWrite: Math.max(a.cacheWrite, p.cacheWrite),
}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })

export function priceFor(model: string): Price | null {
  return PRICES[model] ?? null
}

export interface Usage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** Dollars for one call. The model that answered is priced, or the ceiling when it is unknown. */
export function costOf(servedBy: string, u: Usage): number {
  const p = priceFor(servedBy) ?? CEILING
  const m = 1_000_000
  return ((u.input_tokens ?? 0) * p.input + (u.output_tokens ?? 0) * p.output
    + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / m
}

/**
 * The most a call can cost, reserved against the cap before it is made: every input
 * character counted as a token (an over-estimate), written to the cache at the write
 * rate, plus the full output allowance, at the ceiling price so a fallback is covered.
 */
export function worstCase(inputChars: number, maxOutput: number): number {
  return (inputChars * CEILING.cacheWrite + maxOutput * CEILING.output) / 1_000_000
}
