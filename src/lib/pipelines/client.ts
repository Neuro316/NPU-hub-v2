// src/lib/pipelines/client.ts
// Browser helpers for pipeline positions. Reads go straight to the tables under staff RLS (./positions.ts with the
// browser client); writes go through /api/crm/pipeline-positions, because only the service role may call the RPCs.
import type { Position } from './positions'

async function call(method: 'GET' | 'POST' | 'DELETE', body?: unknown, query?: string): Promise<{ positions: Position[]; removed?: boolean }> {
  const res = await fetch(`/api/crm/pipeline-positions${query ? `?${query}` : ''}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json?.error || 'Something went wrong. Try again.')
  return { positions: json.positions ?? [], removed: json.removed }
}

/** Every position of one contact. */
export const fetchContactPositions = (orgId: string, contactId: string) =>
  call('GET', undefined, `org_id=${encodeURIComponent(orgId)}&contact_id=${encodeURIComponent(contactId)}`).then((r) => r.positions)

/** Sets the stage in that stage's pipeline, adding the contact to it if needed. Returns the contact's positions after. */
export const apiSetStage = (contactId: string, stageId: string, source = 'manual') =>
  call('POST', { contact_id: contactId, stage_id: stageId, source }).then((r) => r.positions)

/** Removes the contact from one pipeline only. Returns the contact's positions after. */
export const apiRemoveFromPipeline = (contactId: string, pipelineId: string) =>
  call('DELETE', { contact_id: contactId, pipeline_id: pipelineId }).then((r) => r.positions)
