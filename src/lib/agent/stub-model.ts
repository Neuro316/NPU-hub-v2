// src/lib/agent/stub-model.ts
// A scripted model for clicking through the Campaign Builder and the Hub Guide locally without
// an API key or spend. Used only when AGENT_STUB_MODEL=1 AND NODE_ENV is not production
// (clientFor below); a production build can never return it. It answers through the same
// tools the real model uses, so every check in the loop still runs on its output.
import type { ModelClient, ModelReply } from './model'
import { liveClient } from './model'

const reply = (name: string, input: unknown, n: number): ModelReply => ({
  model: 'stub', stop_reason: 'tool_use', usage: { input_tokens: 0, output_tokens: 0 },
  content: [{ type: 'tool_use', id: `stub_${name}_${n}`, name, input }] as any,
})

const lastText = (messages: any[]) => {
  const first = messages.find((m) => m.role === 'user')
  return typeof first?.content === 'string' ? first.content : ''
}
const toolResults = (messages: any[]) => messages.flatMap((m) => (Array.isArray(m.content) ? m.content : []))
  .filter((b: any) => b?.type === 'tool_result').map((b: any) => String(b.content ?? ''))

export function stubClient(): ModelClient {
  return {
    async create(req: any) {
      const tools: string[] = (req.tools ?? []).map((t: any) => t.name)
      const turn = (req.messages ?? []).filter((m: any) => m.role === 'assistant').length
      if (tools.includes('search_help')) {
        if (turn === 0) {
          const q = (/Their question: ([\s\S]*)$/.exec(lastText(req.messages))?.[1] ?? 'help').slice(0, 200)
          return reply('search_help', { query: q }, turn)
        }
        const found = toolResults(req.messages).join('\n')
        const m = /\(id: ([a-z0-9-]+), page: ([^)]+)\)\nControls: ([^\n]*)\n[^\n]*\nSteps:\n1\. ([^\n]+)/.exec(found)
        if (!m) return reply('answer', { found: false, text: 'The help articles do not cover this yet.', cited: [], steps: [], handoff: false }, turn)
        const control = m[3].split(',')[0].trim()
        return reply('answer', { found: true, text: `Here is how, from the help article ${m[1]}. (Stub model: the text is canned.)`, cited: [m[1]],
          // up to three of the article's own steps, so a walkthrough can be followed across pages;
          // the first points at the article's page and first control
          steps: [{ article: m[1], text: m[4], route: m[2], ...(control && control !== 'none' ? { target: control } : {}) },
            ...(found.slice(m.index).split('\n\n# ')[0].match(/\n[23]\. [^\n]+/g) ?? []).map((l) => ({ article: m[1], text: l.replace(/^\n\d\. /, '') }))],
          handoff: /build|draft|create/i.test(lastText(req.messages)) }, turn)
      }
      // the builder: one campaign, three steps, one task, then finish
      const script = [
        () => reply('set_campaign', { name: 'Stub draft: guide giveaway', description: 'Drafted by the stub model for a click-through.' }, turn),
        () => reply('set_messages', { name: 'Stub draft steps', steps: [
          { channel: 'email', kind: 'service', delay_minutes: 0, subject: 'Your guide is here', body: 'Hi {{first_name}}, here is the guide you asked for. Reply with any questions.' },
          { channel: 'wait', delay_minutes: 1440 },
          { channel: 'email', kind: 'marketing', delay_minutes: 0, subject: 'One idea from the guide', body: 'Hi {{first_name}}, one idea from the guide: notice your state before you plan your day.' },
        ] }, turn),
        () => reply('add_task', { title: 'Review the stub copy', detail: 'The stub model wrote placeholder copy.', kind: 'copy_review' }, turn),
        () => reply('finish', { summary: 'Stub draft: a campaign with three steps and one task.' }, turn),
      ]
      return (script[turn] ?? script[script.length - 1])()
    },
  }
}

/** The model client for a request: the live API, or the stub on a local non-production run. */
export function clientFor(env: Record<string, string | undefined> = process.env): ModelClient {
  return env.AGENT_STUB_MODEL === '1' && env.NODE_ENV !== 'production' ? stubClient() : liveClient()
}
