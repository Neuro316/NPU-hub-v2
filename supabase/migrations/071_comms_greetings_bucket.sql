-- 071_comms_greetings_bucket.sql
-- Voicemail greeting storage (NPU Hub — Twilio Conversations, Stage 1).
--
-- WHY A PUBLIC BUCKET:
--   The greeting is fetched by TWILIO'S SERVERS at call time via <Play>{url},
--   completely unauthenticated. It cannot go through /api/comms/recording (that
--   proxy is session-gated -> Twilio would get a 401 and the caller would hear a
--   TwiML error instead of the greeting). A signed URL was rejected because it
--   expires: the greeting plays on every inbound call indefinitely, so any
--   expiry is a silent time bomb that breaks calls with no alert.
--
-- WHY THAT IS ACCEPTABLE:
--   The object is an OUTGOING recorded message the org chose to play to every
--   caller — it is not caller data and not PII. Voicemails FROM callers stay
--   private and continue to stream through the authenticated recording proxy.
--
-- ASYMMETRIC ACCESS — this is the point of this migration:
--   READ   = public / unauthenticated (Twilio must fetch it).
--   WRITE  = admin staff of the OWNING org only. A random authenticated Hub
--            user (participant, or an admin of a DIFFERENT org) must NOT be
--            able to insert, overwrite, or delete a greeting.
--
-- Path convention (enforced by the write policies below):
--   comms-greetings/{org_id}/greeting-{timestamp}.{mp3|wav}

-- ---------------------------------------------------------------------------
-- 1. Bucket. allowed_mime_types is a SECOND gate behind the route's validation:
--    only formats Twilio's <Play> can actually render are storable at all, so an
--    unplayable file cannot be saved even if the route were bypassed.
--    (Twilio <Play> supports mp3/wav/aiff/gsm/ulaw. WebM/Opus — what
--    MediaRecorder produces natively — is NOT supported and is excluded here.)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'comms-greetings',
  'comms-greetings',
  true,                                    -- public READ (Twilio fetches it)
  5242880,                                 -- 5 MB cap
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/vnd.wave'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Storage RLS on storage.objects, scoped to this bucket only.
--    Note: /api/comms/greeting uploads with the SERVICE ROLE (which bypasses
--    RLS), so these policies are defense-in-depth against a direct
--    browser/anon-key write to the bucket — i.e. exactly the "random
--    authenticated user uploads a greeting" case.
-- ---------------------------------------------------------------------------

-- READ: intentionally unrestricted. Twilio is anonymous; there is no session to
-- gate on. Scoped to this bucket alone — no other bucket is affected.
drop policy if exists "comms_greetings_public_read" on storage.objects;
create policy "comms_greetings_public_read"
  on storage.objects for select
  to public
  using (bucket_id = 'comms-greetings');

-- WRITE (insert / update / delete): admin staff of the owning org only.
--   * superadmin -> any org (mirrors the 067 policy shape).
--   * admin      -> only orgs they belong to, matched on the FIRST path segment.
-- The org segment is compared as TEXT against user_org_ids()::text rather than
-- casting the path to uuid: a non-uuid folder name would make a ::uuid cast
-- throw instead of simply failing the check, and AND-branch evaluation order is
-- not guaranteed, so a regex guard would not reliably protect the cast.
-- facilitator is deliberately EXCLUDED — changing what every caller hears is an
-- admin action, matching ADMIN_ROLES in src/lib/org-settings-keys.ts.
drop policy if exists "comms_greetings_staff_insert" on storage.objects;
create policy "comms_greetings_staff_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'comms-greetings'
    and (
      get_my_role() = 'superadmin'
      or (
        get_my_role() = 'admin'
        and (storage.foldername(name))[1] in (select user_org_ids()::text)
      )
    )
  );

drop policy if exists "comms_greetings_staff_update" on storage.objects;
create policy "comms_greetings_staff_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'comms-greetings'
    and (
      get_my_role() = 'superadmin'
      or (
        get_my_role() = 'admin'
        and (storage.foldername(name))[1] in (select user_org_ids()::text)
      )
    )
  )
  with check (
    bucket_id = 'comms-greetings'
    and (
      get_my_role() = 'superadmin'
      or (
        get_my_role() = 'admin'
        and (storage.foldername(name))[1] in (select user_org_ids()::text)
      )
    )
  );

drop policy if exists "comms_greetings_staff_delete" on storage.objects;
create policy "comms_greetings_staff_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'comms-greetings'
    and (
      get_my_role() = 'superadmin'
      or (
        get_my_role() = 'admin'
        and (storage.foldername(name))[1] in (select user_org_ids()::text)
      )
    )
  );

-- ---------------------------------------------------------------------------
-- Verification probes (run manually after apply; all should hold):
--   select public, file_size_limit, allowed_mime_types
--     from storage.buckets where id = 'comms-greetings';
--   select policyname, cmd, roles from pg_policies
--    where tablename = 'objects' and policyname like 'comms_greetings%';
--   -- expect: 1 SELECT policy to {public}, 3 write policies to {authenticated}
-- ---------------------------------------------------------------------------
