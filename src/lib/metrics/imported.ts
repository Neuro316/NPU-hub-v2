// src/lib/metrics/imported.ts
// THE import rule, in a module with no imports so client pages can use it without the metrics collector.
// collect.ts re-exports it; every reader imports the one function.

/**
 * THE import rule (2026-11-23): an imported contact is never a fresh lead. True when the contact came in through an
 * import batch (import_batch_id), or its source is 'sensorium_import' or starts with 'import'. It keeps an imported
 * contact out of speed to lead (collect.ts), the brief's new leads line (notify/brief.ts), lead_no_touch_24h
 * (lifecycle/scan.ts), and the CRM activity tiles until a first touch (metrics/contact-tiles.ts). leadChannel is
 * unchanged: the leads-by-channel tile still reports it by its created_at and source.
 */
export function isImportedLead(c: { import_batch_id?: string | null; source?: string | null }): boolean {
  if (c.import_batch_id) return true
  const s = typeof c.source === 'string' ? c.source.trim().toLowerCase() : ''
  return s === 'sensorium_import' || s.startsWith('import')
}
