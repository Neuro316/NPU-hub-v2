-- BRANCH ONLY. NEVER APPLY TO THE LIVE PROJECT.
--
-- The objects hub_213 writes into or fires through that hub_211_dependencies.sql and
-- hub_212_dependencies.sql do not create. Load order on a fresh branch:
--   hub_211_dependencies.sql, hub_211, hub_212_dependencies.sql, hub_212, THIS FILE, hub_213.
-- Copied from live pg_catalog on 2026-10-01: columns, defaults, NOT NULL, PK, unique and
-- check constraints, the FKs between copied objects and to organizations, profiles and
-- auth.users, and the TRIGGERS on public.tasks with their function bodies (code as live,
-- comment lines trimmed), because
-- agent_build inserts into tasks and the tests must see what those triggers really do.
--
-- FKs NOT copied, listed by name (marketing section 12: a bootstrap that silently drops a
-- constraint makes every test on that table blind to it). agent_build never writes these
-- columns; they stay NULL in every test row:
--   tasks_call_log_id_fkey        tasks.call_log_id        -> call_logs(id)
--   kanban_tasks_project_id_fkey  kanban_tasks.project_id  -> projects(id)
--   kanban_tasks_rock_id_fkey     kanban_tasks.rock_id     -> rocks(id)
-- Not copied: trg_sync_kanban_to_task (AFTER UPDATE on kanban_tasks; nothing in hub_213
-- updates a kanban row). kanban_* id defaults use gen_random_uuid() where live uses
-- extensions.uuid_generate_v4(), which a fresh branch may not have; same type, same role.
-- notifications and hub_sms_outbox are copied so the "notifies nobody" assertion counts
-- real tables. On live, the only triggers that insert into either are on messages and
-- message_reactions (pg_catalog, 2026-10-01).

create table public.team_members (
  id uuid default gen_random_uuid() not null primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  email text not null,
  role text default 'member'::text not null check (role = any (array['admin'::text, 'manager'::text, 'member'::text])),
  is_active boolean default true not null,
  auto_assign_weight integer default 1 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  unique (org_id, user_id)
);

create table public.kanban_columns (
  id uuid default gen_random_uuid() not null primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  color text default '#6B7280'::text,
  sort_order integer default 0,
  created_at timestamp with time zone default now()
);

create table public.kanban_tasks (
  id uuid default gen_random_uuid() not null primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  column_id uuid not null references public.kanban_columns(id) on delete cascade,
  title text not null,
  description text,
  assignee text,
  priority text default 'medium'::text check (priority = any (array['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])),
  due_date date,
  visibility text default 'everyone'::text check (visibility = any (array['everyone'::text, 'private'::text, 'specific'::text])),
  sort_order integer default 0,
  custom_fields jsonb default '{}'::jsonb,
  created_by text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  rock_id uuid,
  source text default 'manual'::text,
  raci_responsible text,
  raci_accountable text,
  raci_consulted text[] default '{}'::text[],
  raci_informed text[] default '{}'::text[],
  rock_tags text[] default '{}'::text[],
  estimated_hours numeric,
  actual_hours numeric,
  depends_on uuid[] default '{}'::uuid[],
  blocked_by uuid[] default '{}'::uuid[],
  sequence_order integer,
  milestone boolean default false,
  ai_generated boolean default false,
  approved_at timestamp with time zone,
  approved_by uuid,
  started_at timestamp with time zone,
  completed_at timestamp with time zone,
  owner_id uuid,
  project_id uuid,
  parent_task_id uuid references public.kanban_tasks(id) on delete set null,
  is_epic boolean default false,
  blocks_count integer default 0,
  blocked_by_count integer default 0,
  subtasks_count integer default 0,
  subtasks_complete integer default 0
);

create table public.tasks (
  id uuid default gen_random_uuid() not null primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid,
  assigned_to uuid references public.team_members(id),
  title text not null,
  description text,
  priority text default 'medium'::text not null check (priority = any (array['low'::text, 'medium'::text, 'high'::text, 'urgent'::text])),
  status text default 'todo'::text not null check (status = any (array['todo'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])),
  due_date timestamp with time zone,
  completed_at timestamp with time zone,
  source text default 'manual'::text,
  call_log_id uuid,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  raci_responsible uuid[] default '{}'::uuid[],
  raci_accountable uuid,
  raci_consulted uuid[] default '{}'::uuid[],
  raci_informed uuid[] default '{}'::uuid[],
  kanban_column text default 'todo'::text,
  kanban_order integer default 0,
  hub_task_id uuid,
  labels text[] default '{}'::text[],
  checklist jsonb default '[]'::jsonb,
  estimated_minutes integer,
  actual_minutes integer,
  last_synced_at timestamp with time zone,
  source_id uuid,
  created_by uuid
);

create table public.hub_sms_outbox (
  id uuid default gen_random_uuid() not null primary key,
  org_id uuid not null,
  user_id uuid not null,
  body text not null check (length(body) >= 1 and length(body) <= 18500),
  source text,
  status text default 'pending'::text not null check (status = any (array['pending'::text, 'sending'::text, 'sent'::text, 'failed'::text, 'skipped'::text])),
  attempts integer default 0 not null,
  sent_parts integer default 0 not null,
  total_parts integer,
  last_error text,
  created_at timestamp with time zone default now() not null,
  claimed_at timestamp with time zone,
  sent_at timestamp with time zone
);

create table public.notifications (
  id uuid default gen_random_uuid() not null primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text default ''::text,
  link text,
  read boolean default false,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now()
);

grant select, insert, update, delete on public.team_members, public.kanban_columns, public.kanban_tasks,
  public.tasks, public.hub_sms_outbox, public.notifications to service_role;

-- ── the three trigger functions on public.tasks, bodies verbatim from live ──
create or replace function public.update_updated_at()
 returns trigger
 language plpgsql
as $function$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$function$;

create or replace function public.trigger_task_timeline()
 returns trigger
 language plpgsql
as $function$
BEGIN
  IF NEW.contact_id IS NOT NULL THEN
    INSERT INTO contact_timeline (org_id, contact_id, event_type, title, description, metadata, source_table, source_id, occurred_at)
    VALUES (NEW.org_id, NEW.contact_id,
      CASE WHEN NEW.status = 'done' THEN 'task_completed' ELSE 'task_created' END,
      CASE WHEN NEW.status = 'done' THEN 'Task completed: ' ELSE 'Task created: ' END || NEW.title,
      NEW.description,
      jsonb_build_object('priority', NEW.priority, 'status', NEW.status),
      'tasks', NEW.id, NEW.created_at);
  END IF;
  RETURN NEW;
END;
$function$;

create or replace function public.fn_sync_task_to_kanban()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_column_id uuid;
  v_col_title text;
  v_hub_id uuid;
  v_syncing text;
BEGIN
  -- Loop guard
  BEGIN
    v_syncing := current_setting('app.is_syncing', true);
  EXCEPTION WHEN OTHERS THEN
    v_syncing := '';
  END;
  IF v_syncing = 'true' THEN RETURN NEW; END IF;

  v_col_title := CASE NEW.status
    WHEN 'todo' THEN 'To Do'
    WHEN 'in_progress' THEN 'In Progress'
    WHEN 'done' THEN 'Done'
    WHEN 'cancelled' THEN 'Done'
    ELSE 'To Do'
  END;

  SELECT id INTO v_column_id
  FROM kanban_columns
  WHERE org_id = NEW.org_id AND title = v_col_title
  LIMIT 1;

  IF v_column_id IS NULL THEN
    SELECT id INTO v_column_id
    FROM kanban_columns
    WHERE org_id = NEW.org_id
    ORDER BY sort_order ASC
    LIMIT 1;
  END IF;

  IF v_column_id IS NULL THEN RETURN NEW; END IF;

  PERFORM set_config('app.is_syncing', 'true', true);

  IF TG_OP = 'INSERT' THEN
    INSERT INTO kanban_tasks (
      org_id, column_id, title, description, assignee,
      priority, due_date, sort_order, custom_fields, created_by
    ) VALUES (
      NEW.org_id, v_column_id, NEW.title, NEW.description, NULL,
      NEW.priority, NEW.due_date, COALESCE(NEW.kanban_order, 0),
      jsonb_build_object(
        'crm_task_id', NEW.id,
        'contact_id', NEW.contact_id,
        'raci', jsonb_build_object(
          'responsible', COALESCE(to_jsonb(NEW.raci_responsible), '[]'::jsonb),
          'accountable', to_jsonb(NEW.raci_accountable),
          'consulted', COALESCE(to_jsonb(NEW.raci_consulted), '[]'::jsonb),
          'informed', COALESCE(to_jsonb(NEW.raci_informed), '[]'::jsonb)
        ),
        'labels', COALESCE(to_jsonb(NEW.labels), '[]'::jsonb),
        'checklist', COALESCE(NEW.checklist, '[]'::jsonb),
        'source', NEW.source
      ),
      NEW.created_by
    )
    RETURNING id INTO v_hub_id;

    UPDATE tasks SET hub_task_id = v_hub_id, last_synced_at = now()
    WHERE id = NEW.id;

  ELSIF TG_OP = 'UPDATE' AND NEW.hub_task_id IS NOT NULL THEN
    UPDATE kanban_tasks SET
      column_id = v_column_id,
      title = NEW.title,
      description = NEW.description,
      priority = NEW.priority,
      due_date = NEW.due_date,
      sort_order = COALESCE(NEW.kanban_order, sort_order),
      custom_fields = jsonb_build_object(
        'crm_task_id', NEW.id,
        'contact_id', NEW.contact_id,
        'raci', jsonb_build_object(
          'responsible', COALESCE(to_jsonb(NEW.raci_responsible), '[]'::jsonb),
          'accountable', to_jsonb(NEW.raci_accountable),
          'consulted', COALESCE(to_jsonb(NEW.raci_consulted), '[]'::jsonb),
          'informed', COALESCE(to_jsonb(NEW.raci_informed), '[]'::jsonb)
        ),
        'labels', COALESCE(to_jsonb(NEW.labels), '[]'::jsonb),
        'checklist', COALESCE(NEW.checklist, '[]'::jsonb),
        'source', NEW.source
      ),
      updated_at = now()
    WHERE id = NEW.hub_task_id;

    UPDATE tasks SET last_synced_at = now() WHERE id = NEW.id;
  END IF;

  PERFORM set_config('app.is_syncing', '', true);
  RETURN NEW;
END;
$function$;

create trigger trg_sync_task_to_kanban after insert or update of title, description, status, priority, due_date,
  raci_responsible, raci_accountable, raci_consulted, raci_informed, labels, checklist, kanban_column, kanban_order
  on public.tasks for each row execute function fn_sync_task_to_kanban();
create trigger trg_task_timeline after insert on public.tasks for each row execute function trigger_task_timeline();
create trigger trg_updated_at before update on public.tasks for each row execute function update_updated_at();
