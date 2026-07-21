-- 070_conversations_contact_fk.sql
-- ROOT CAUSE of the empty Conversations list (verified 2026-07-21):
--   The list query embeds contacts!inner(...) via PostgREST, which resolves embeds
--   through FOREIGN KEYS. conversations.contact_id had NO FK to contacts(id) — the
--   original crm_001 FK was lost at some point — so PostgREST returns
--   "Could not find a relationship between conversations and contacts" (HTTP 400),
--   the browser gets null, and the list renders "No conversations found".
--   The rows persist fine (16dcc0d3 threaded correctly to the Cameron Allen contact
--   and is visible under RLS); only the LIST query has been broken, on every load,
--   since the FK went missing. crm_messages already has its conversations FK, so
--   the message pane / merged timeline are unaffected.
--
-- FIX: (re)add the FK so PostgREST can embed contacts on conversations.
--   Added NOT VALID: there is 1 existing orphan conversation whose contact_id points
--   at a deleted contact (b2588476, 0 messages). NOT VALID means the migration does
--   not delete it and does not fail validating it, while PostgREST STILL picks up the
--   constraint for embedding and NEW rows are FK-checked. The orphan never displays
--   (the inner join excludes it).
--
-- State at write time: 3 conversations, 0 null contact_id, 1 orphan.

ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
  NOT VALID;

-- Nudge PostgREST to reload its schema cache so the new relationship is usable
-- immediately (Supabase also auto-reloads on DDL, this is belt-and-suspenders).
NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- OPTIONAL later cleanup (NOT run here) — for a fully-valid constraint:
--   DELETE FROM conversations cv
--   WHERE cv.contact_id IS NOT NULL
--     AND NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = cv.contact_id);
--   ALTER TABLE conversations VALIDATE CONSTRAINT conversations_contact_id_fkey;
--
-- PROBE (after apply): the list query should return rows.
--   select id from conversations order by last_message_at desc nulls last;  -- 3 rows
--   -- and in the app, the Conversations tab shows the Cameron Allen thread.
-- ---------------------------------------------------------------------------
