// src/lib/agent/model.ts
// The one place the agent talks to the Claude API, through the official SDK already in the
// repo. Callers receive a ModelClient, so the golden tests replay recorded responses with
// no network (AG6). The key is read per call and never logged (ruling 11).
import Anthropic from '@anthropic-ai/sdk'
import { MODEL_TIMEOUT_MS } from './config'

export type MessageParam = Anthropic.MessageParam
export type Tool = Anthropic.Tool
export type ContentBlock = Anthropic.ContentBlock
export type ToolUseBlock = Anthropic.ToolUseBlock
export type TextBlockParam = Anthropic.TextBlockParam

export interface ModelRequest {
  model: string
  max_tokens: number
  system: TextBlockParam[]
  tools: Tool[]
  messages: MessageParam[]
}

export interface ModelReply {
  model: string
  stop_reason: string | null
  content: ContentBlock[]
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }
}

export interface ModelClient { create(req: ModelRequest): Promise<ModelReply> }

/** Models that accept the server-side refusal fallback ("default" form, Claude API only). */
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1'])

export class ModelUnavailable extends Error {}
export class ModelMisconfigured extends Error {}

export function liveClient(): ModelClient {
  return {
    async create(req) {
      const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim()
      if (!apiKey) throw new ModelMisconfigured('missing_key')
      const client = new Anthropic({ apiKey, timeout: MODEL_TIMEOUT_MS, maxRetries: 1 })
      try {
        if (FALLBACK_MODELS.has(req.model)) {
          // a declined request is re-run on another model inside the same call; the reply's
          // `model` says which model answered, and cost is priced from that (pricing.ts)
          const r = await client.beta.messages.create({ ...req, tool_choice: { type: 'auto' }, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } as any)
          return r as unknown as ModelReply
        }
        const r = await client.messages.create({ ...req, tool_choice: { type: 'auto' } })
        return r as unknown as ModelReply
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new ModelMisconfigured('auth')
        if (e instanceof Anthropic.BadRequestError || e instanceof Anthropic.NotFoundError) {
          console.error(`[agent/model] request refused by the API: ${e.status}`)
          throw new ModelMisconfigured('bad_request')
        }
        // timeouts, rate limits, overload, network: the run ends with nothing built
        throw new ModelUnavailable(e instanceof Anthropic.APIError ? `status_${e.status}` : 'network')
      }
    },
  }
}
