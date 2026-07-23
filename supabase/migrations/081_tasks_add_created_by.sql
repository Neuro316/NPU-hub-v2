-- 081_tasks_add_created_by.sql
-- Task creation has NEVER worked (tasks table had 0 rows) because the sync
-- trigger fn_sync_task_to_kanban (fired AFTER INSERT/UPDATE on tasks) reads
-- NEW.created_by to populate kanban_tasks.created_by -- but the tasks table has
-- no created_by column. Every insert therefore aborts with
--   ERROR 42703: record "new" has no field "created_by"
-- and rolls back, regardless of what the client sends. (The client also sent
-- phantom columns -- attachments / custom_fields -- which PostgREST rejected;
-- those are removed in the same change. But the trigger is the deeper killer.)
--
-- The trigger, the client insert paths, and the CrmTask type all already expect
-- tasks.created_by. It is simply missing -- a migration drift. Adding it makes
-- the trigger resolve, unblocking every create path and restoring the intended
-- CRM-task -> kanban_tasks (Task Manager) sync.
--
-- Plain uuid, nullable, NO foreign key: it stores the auth user id the client
-- passes and flows to kanban_tasks.created_by (which is text). No FK means this
-- does not step on the team_members-id-vs-auth-id trap; if team-member
-- provenance is wanted later, resolve via the shared helper before insert.

alter table public.tasks add column if not exists created_by uuid;

-- Verification:
--   select column_name from information_schema.columns
--    where table_name='tasks' and column_name='created_by';   -- expect 1 row
--   -- then a create from the CRM contact panel or Tasks tab should succeed and
--   -- mirror into kanban_tasks (hub_task_id gets populated on the tasks row).
