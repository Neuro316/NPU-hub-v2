// src/lib/marketing/ai-review.ts
// Whether a sequence still holds copy the Campaign Builder drafted that nobody has reviewed
// (agent rulings 1 and 14). Its sequences are saved active like any other, so every path that
// can send from a sequence asks this first, with the client it already reads that sequence
// with. A failed read answers 'unknown', which callers treat as a refusal, never as clear.
import type { SupabaseClient } from '@supabase/supabase-js'

export type AiReviewState = 'clear' | 'unreviewed' | 'unknown'

export async function aiReviewState(db: SupabaseClient, sequenceId: string): Promise<AiReviewState> {
  const { data, error } = await db.from('sequence_steps').select('id').eq('sequence_id', sequenceId)
    .not('ai_run_id', 'is', null).is('ai_reviewed_at', null).limit(1)
  if (error) return 'unknown'
  return (data?.length ?? 0) > 0 ? 'unreviewed' : 'clear'
}
