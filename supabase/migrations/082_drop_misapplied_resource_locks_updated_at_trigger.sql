-- 082_drop_misapplied_resource_locks_updated_at_trigger.sql  (APPLIED 2026-07-23)
-- The generic update_updated_at trigger sets NEW.updated_at := now(), but
-- resource_locks has no updated_at column (it uses locked_at / heartbeat_at /
-- expires_at). Any UPDATE to a lock -- collaborative-mode promotion or an
-- upsert-on-conflict from use-collaboration.tsx -- would abort with
-- "record new has no field updated_at". Misapplied by copy-paste; no code reads
-- updated_at here. Drop the trigger rather than add a vestigial column.
drop trigger if exists update_resource_locks_updated_at on public.resource_locks;
