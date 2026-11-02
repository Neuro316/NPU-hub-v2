-- hub_216_mail_connections.sql
--
-- STATUS: PROPOSED, NOT APPLIED. Apply to production (htfrfaxlcuyawtlztxxm) only,
-- through the Supabase connector as migration name hub_216_mail_connections, after
-- an explicit go. Not for npu-platform-nonprod: the Hub has no nonprod.
--
-- Hub band (200+). Checked 2026-11-01: files stop at hub_214, but the ledger already
-- holds hub_215_quick_send (version 20261031160805, applied before the 2026-10-31
-- release revert removed its file). 215 is therefore taken; this is 216.
-- Vault: supabase_vault 0.3.1 is installed; service_role has usage on schema vault
-- and on vault.secrets / vault.decrypted_secrets / vault.create_secret (read
-- 2026-11-01). authenticated has no usage on vault.
--
-- PURPOSE: phase 1 of the inbox agent. One row per Gmail mailbox a Hub user has
-- connected through Google OAuth (docs/plans/hub-gmail-mailboxes-rulings.md).
-- The refresh token lives ONLY in Supabase Vault; the row keeps the vault secret id.
--
--   visibility   'private': listed and usable only by owner_user_id.
--                'shared':  listed to superadmins who belong to org_id (ops@).
--   status       'active' | 'revoked' | 'error'. A revoked row has no secret
--                (vault_secret_id NULL); reconnecting the same address reuses the row.
--   last_error   a short fixed message written by the Hub, never a Google response body.
--
-- The three callable functions are SECURITY INVOKER (the nr_calendar_token_* pattern, migration
-- 176): they work because the caller is service_role, which already holds the vault
-- privileges. EXECUTE is revoked from public, anon and authenticated. The delete
-- trigger function alone is SECURITY DEFINER (see its comment).
--
-- ACCESS: RLS on with no policies; anon and authenticated have no privileges.
-- service_role only, through /api/mail/*, which checks superadmin + ownership.
--
-- ROLLBACK:
--   begin;
--   delete from vault.secrets where id in (select vault_secret_id from public.hub_mail_connections);
--   drop table if exists public.hub_mail_connections;   -- drops the trigger
--   drop function if exists public.hub_mail_connection_put(uuid, uuid, text, text, text[]);
--   drop function if exists public.hub_mail_token_get(uuid);
--   drop function if exists public.hub_mail_connection_revoke(uuid);
--   drop function if exists public.hub_mail_connections_drop_secret();
--   delete from supabase_migrations.schema_migrations where name = 'hub_216_mail_connections';
--   commit;

begin;

create table public.hub_mail_connections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null,
  owner_user_id    uuid not null references auth.users(id) on delete cascade,
  email_address    text not null unique
                   check (email_address = lower(email_address) and email_address like '%@neuroprogeny.com'),
  visibility       text not null default 'private' check (visibility in ('private', 'shared')),
  vault_secret_id  uuid,
  scopes           text[] not null default '{}',
  status           text not null default 'active' check (status in ('active', 'revoked', 'error')),
  connected_at     timestamptz not null default now(),
  last_checked_at  timestamptz,
  last_error       text check (last_error is null or length(last_error) <= 300),
  check (status = 'revoked' or vault_secret_id is not null)
);

create index hub_mail_connections_owner on public.hub_mail_connections (owner_user_id);
create index hub_mail_connections_org on public.hub_mail_connections (org_id);

alter table public.hub_mail_connections enable row level security;
revoke all on public.hub_mail_connections from public, anon, authenticated;
grant all on public.hub_mail_connections to service_role;

comment on table public.hub_mail_connections is
  'Gmail mailboxes connected through Google OAuth (inbox agent phase 1). Refresh token is in '
  'Vault only (vault_secret_id). private = owner only; shared = superadmins of org_id. '
  'service_role only via /api/mail/*.';

-- ─── put: create or reconnect, writing the refresh token to Vault ────────────
-- Raises 'mailbox_owned_by_other' when the address is live (active or error) under
-- another user, so one user can never take over another user's mailbox.
-- A revoked row may be claimed by whoever reconnects it; it resets to private.
create function public.hub_mail_connection_put(
  p_org_id uuid, p_owner uuid, p_email text, p_secret text, p_scopes text[]
) returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  v_email     text := lower(trim(p_email));
  v_row       public.hub_mail_connections%rowtype;
  v_id        uuid;
  v_secret_id uuid;
begin
  if p_secret is null or length(p_secret) = 0 then
    raise exception 'mailbox_secret_missing';
  end if;

  select * into v_row from public.hub_mail_connections c where c.email_address = v_email for update;

  if found and v_row.status <> 'revoked' and v_row.owner_user_id <> p_owner then
    raise exception 'mailbox_owned_by_other';
  end if;

  v_id := coalesce(v_row.id, gen_random_uuid());
  v_secret_id := v_row.vault_secret_id;

  if v_secret_id is null then
    select s.id into v_secret_id from vault.secrets s where s.name = 'hub_mail_connection:' || v_id::text;
  end if;

  if v_secret_id is null then
    v_secret_id := vault.create_secret(
      p_secret, 'hub_mail_connection:' || v_id::text,
      'Gmail refresh token for hub_mail_connections ' || v_id::text || ' (hub_216)');
  else
    perform vault.update_secret(v_secret_id, p_secret);
  end if;

  if v_row.id is null then
    insert into public.hub_mail_connections
      (id, org_id, owner_user_id, email_address, vault_secret_id, scopes, status, connected_at)
    values
      (v_id, p_org_id, p_owner, v_email, v_secret_id, coalesce(p_scopes, '{}'), 'active', now());
  else
    update public.hub_mail_connections c
       set org_id          = p_org_id,
           owner_user_id   = p_owner,
           visibility      = case when v_row.owner_user_id = p_owner then c.visibility else 'private' end,
           vault_secret_id = v_secret_id,
           scopes          = coalesce(p_scopes, '{}'),
           status          = 'active',
           connected_at    = now(),
           last_error      = null
     where c.id = v_id;
  end if;

  return v_id;
end
$function$;

-- ─── get: the refresh token, for a live connection only ─────────────────────
create function public.hub_mail_token_get(p_connection_id uuid)
returns text
language sql
stable
set search_path to ''
as $function$
  select s.decrypted_secret
    from vault.decrypted_secrets s
    join public.hub_mail_connections c on c.vault_secret_id = s.id
   where c.id = p_connection_id
     and c.status <> 'revoked'
$function$;

-- ─── revoke: delete the Vault secret and mark the row revoked ───────────────
create function public.hub_mail_connection_revoke(p_connection_id uuid)
returns void
language plpgsql
set search_path to ''
as $function$
declare
  v_secret_id uuid;
begin
  select c.vault_secret_id into v_secret_id
    from public.hub_mail_connections c where c.id = p_connection_id for update;

  update public.hub_mail_connections c
     set status = 'revoked', vault_secret_id = null, last_error = null
   where c.id = p_connection_id;

  if v_secret_id is not null then
    delete from vault.secrets s where s.id = v_secret_id;
  end if;
end
$function$;

-- ─── a deleted row (including an auth.users cascade) takes its secret with it ─
-- SECURITY DEFINER: a user deletion cascades from auth.users and runs as the auth
-- admin role, which has no vault access; as invoker this trigger would make every
-- Hub user deletion fail. Owned by the migration role (postgres), which does.
create function public.hub_mail_connections_drop_secret()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if old.vault_secret_id is not null then
    delete from vault.secrets s where s.id = old.vault_secret_id;
  end if;
  return old;
end
$function$;

create trigger hub_mail_connections_drop_secret
  after delete on public.hub_mail_connections
  for each row execute function public.hub_mail_connections_drop_secret();

revoke all on function public.hub_mail_connection_put(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.hub_mail_token_get(uuid) from public, anon, authenticated;
revoke all on function public.hub_mail_connection_revoke(uuid) from public, anon, authenticated;
revoke all on function public.hub_mail_connections_drop_secret() from public, anon, authenticated;
grant execute on function public.hub_mail_connection_put(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.hub_mail_token_get(uuid) to service_role;
grant execute on function public.hub_mail_connection_revoke(uuid) to service_role;

commit;
