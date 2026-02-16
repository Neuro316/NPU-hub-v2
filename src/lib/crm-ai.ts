import Anthropic from '@anthropic-ai/sdk';
import { createAdminSupabase } from '@/lib/supabase';

// Get Anthropic client - checks org settings first, falls back to env var
async function getAnthropicClient(orgId?: string): Promise<Anthropic> {
  if (orgId) {
    try {
      const supabase = createAdminSupabase();
      const { data } = await supabase
        .from('org_settings')
        .select('setting_value')
        .eq('org_id', orgId)
        .eq('setting_key', 'crm_ai')
        .maybeSingle();

      if (data?.setting_value?.anthropic_key) {
        return new Anthropic({ apiKey: data.setting_value.anthropic_key });
      }
    } catch (e) {
      console.warn('Failed to load org AI config, using env:', e);
    }
  }

  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

// ─── Call Summary ───
export async function generateCallSummary(transcription: string, orgId?: string): Promise<string> {
  const client = await getAnthropicClient(orgId);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Summarize this call between a neurotherapy practitioner and a client. Focus on: key topics discussed, commitments made, and recommended follow-ups. Keep it under 3 sentences.\n\nTranscription:\n${transcription}`
    }],
  });

  const block = response.content[0];
  return block.type === 'text' ? block.text : '';
}

// ─── Sentiment Analysis ───
export async function analyzeSentiment(
  text: string, orgId?: string
): Promise<'positive' | 'neutral' | 'negative' | 'concerned'> {
  const client = await getAnthropicClient(orgId);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 50,
    messages: [{
      role: 'user',
      content: `Classify the sentiment of this conversation as exactly one of: positive, neutral, negative, concerned. Respond with only that single word.\n\nText:\n${text}`
    }],
  });

  const block = response.content[0];
  const result = block.type === 'text' ? block.text.trim().toLowerCase() : 'neutral';
  const valid = ['positive', 'neutral', 'negative', 'concerned'] as const;
  return valid.includes(result as any) ? (result as typeof valid[number]) : 'neutral';
}

// ─── Auto-Task Extraction ───
export interface ExtractedTask {
  title: string;
  description: string;
  due_date: string;
  priority: 'low' | 'medium' | 'high';
  suggested_role: string;
}

export async function extractTasks(text: string, orgId?: string): Promise<ExtractedTask[]> {
  const client = await getAnthropicClient(orgId);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Extract action items from this conversation. Return a JSON array (and nothing else) where each item has: title (string), description (string), due_date (relative like "in 3 days"), priority ("low", "medium", or "high"), suggested_role (who should handle this, e.g. "practitioner", "admin", "manager"). If no action items exist, return an empty array [].\n\nConversation:\n${text}`
    }],
  });

  try {
    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '[]';
    const cleaned = raw.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

// ─── Smart Reply Suggestions ───
export async function generateSmartReplies(messages: string[], orgId?: string): Promise<string[]> {
  const thread = messages.map((m, i) => `${i % 2 === 0 ? 'Contact' : 'You'}: ${m}`).join('\n');
  const client = await getAnthropicClient(orgId);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `You are a neurotherapy practitioner. Given this SMS thread, suggest 3 brief, warm replies. Each under 160 characters. Return a JSON array of 3 strings (and nothing else).\n\nThread:\n${thread}`
    }],
  });

  try {
    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '[]';
    const cleaned = raw.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}

// ─── Duplicate Detection Scoring ───
export async function scoreDuplicates(
  pairs: Array<{ a: { name: string; phone?: string; email?: string }; b: { name: string; phone?: string; email?: string } }>,
  orgId?: string
): Promise<Array<{ index: number; confidence: number; reason: string }>> {
  const client = await getAnthropicClient(orgId);
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250514',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Score these potential duplicate contact pairs. For each pair, return confidence (0-100) that they are the same person, and a brief reason. Return JSON array with: index (number), confidence (number), reason (string).\n\nPairs:\n${JSON.stringify(pairs)}`
    }],
  });

  try {
    const block = response.content[0];
    const raw = block.type === 'text' ? block.text : '[]';
    const cleaned = raw.replace(/```json\n?|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return [];
  }
}
