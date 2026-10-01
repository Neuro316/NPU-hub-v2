// src/lib/agent/help/walkthrough.ts
// Ruling 18: a Guide answer is structured, and every part of it is checked before anyone sees
// it. Cited articles must be ones the search returned in this run; each step must belong to a
// cited article; a step's route must be a real page and its target a real control of that
// article. Anything else is refused and sent back to the model, never shown. Pure.
import type { Article } from './corpus'
import registry from '../help-registry.json'

export interface Registry { routes: string[]; help_ids: string[]; screens: string[] }
export const REGISTRY = registry as Registry

export interface GuideStep { article: string; text: string; route: string | null; target: string | null }
export interface GuideAnswer { found: boolean; text: string; cited: string[]; steps: GuideStep[]; handoff: boolean }

export const MAX_STEPS = 8
export const MAX_ANSWER_CHARS = 1500
const EM_DASH = new RegExp(String.fromCharCode(0x2014), 'g')

export type AnswerCheck = { ok: true; answer: GuideAnswer } | { ok: false; reason: string }

export function checkAnswer(raw: any, retrieved: Map<string, Article>, reg: Registry = REGISTRY): AnswerCheck {
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'The answer must be an object.' }
  const found = raw.found === true
  const text = typeof raw.text === 'string' ? raw.text.trim().replace(EM_DASH, ', ') : ''
  if (!text) return { ok: false, reason: 'The answer needs text.' }
  if (text.length > MAX_ANSWER_CHARS) return { ok: false, reason: `Keep the answer under ${MAX_ANSWER_CHARS} characters.` }
  const cited: string[] = Array.isArray(raw.cited) ? Array.from(new Set(raw.cited.map((x: unknown) => String(x)))) : []
  for (const id of cited) if (!retrieved.has(id)) return { ok: false, reason: `You cited ${id}, which search_help did not return in this conversation. Cite only articles you retrieved.` }
  if (found && !cited.length) return { ok: false, reason: 'An answer from the help set must cite the articles it used.' }
  if (!found && cited.length) return { ok: false, reason: 'An answer marked as not from the help set must not cite articles.' }

  const rawSteps: any[] = Array.isArray(raw.steps) ? raw.steps : []
  if (!found && rawSteps.length) return { ok: false, reason: 'Do not give steps when no article fits.' }
  if (rawSteps.length > MAX_STEPS) return { ok: false, reason: `Give at most ${MAX_STEPS} steps.` }
  const steps: GuideStep[] = []
  for (let i = 0; i < rawSteps.length; i++) {
    const s = rawSteps[i] ?? {}
    const n = `Step ${i + 1}`
    const art = retrieved.get(String(s.article ?? ''))
    if (!art || !cited.includes(art.id)) return { ok: false, reason: `${n} must name one of the articles you cited.` }
    const stepText = typeof s.text === 'string' ? s.text.trim().replace(EM_DASH, ', ') : ''
    if (!stepText || stepText.length > 300) return { ok: false, reason: `${n} needs a plain sentence of at most 300 characters.` }
    const route = typeof s.route === 'string' && s.route.trim() ? s.route.trim() : null
    if (route && !reg.routes.includes(route)) return { ok: false, reason: `${n} names the page ${route}, which does not exist. Use a route from the article.` }
    const target = typeof s.target === 'string' && s.target.trim() ? s.target.trim() : null
    if (target && (!reg.help_ids.includes(target) || !art.help_ids.includes(target))) {
      return { ok: false, reason: `${n} points at ${target}, which is not a control of article ${art.id}. Use one of: ${art.help_ids.join(', ') || 'none'}.` }
    }
    steps.push({ article: art.id, text: stepText, route: route ?? (target ? art.route : null), target })
  }
  return { ok: true, answer: { found, text, cited, steps, handoff: raw.handoff === true } }
}
