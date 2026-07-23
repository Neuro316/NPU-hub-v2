-- 075_lifecycle_label_and_merge_tag_guard.sql
-- Two related fixes, kept deliberately independent.
--
-- (1) BUG: handle_contact_tag_change (AFTER UPDATE OF tags on contacts) inserts
--     into contact_lifecycle_events without `label`, which is NOT NULL. That
--     insert sits mid-trigger, so EVERY firing has rolled back — the table has 0
--     rows and the whole participant-auto-creation pipeline behind it has never
--     persisted. A contact merge unions tags onto the winner, adds the
--     'Mastermind' tag (the one stripe_product_tag_map row with
--     creates_participant=true), fires this trigger, and the merge dies here.
--     FIX: supply a meaningful label on the 'enrolled' lifecycle event.
--
-- (2) DECOUPLING (Option B): fixing (1) would, on its own, ACTIVATE that dormant
--     pipeline for every Mastermind-tag change — including a merge unioning tags.
--     With NPU signups not live yet, a contact merge must NOT quietly start
--     queuing auth-user creation. So the trigger now skips its enrollment body
--     when a transaction-local flag is set, and the merge sets that flag while
--     unioning tags (via merge_union_tags below). The label fix stands on its
--     own; when the enrollment pipeline is wanted live, nothing here needs to
--     change — it already works for normal (unflagged) tag changes.

-- ── Trigger: label supplied + suppress-guard ────────────────────────────────
create or replace function public.handle_contact_tag_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_tag_config RECORD;
  v_new_tags text[];
  v_old_tags text[];
  v_added_tags text[];
  v_tag text;
  v_existing_profile uuid;
BEGIN
  -- Administrative tag changes (a contact merge) set this transaction-local flag
  -- so unioning tags does not re-fire enrollment side effects. Missing flag ->
  -- current_setting returns NULL (missing_ok=true) -> normal enrollment path runs.
  IF coalesce(current_setting('app.suppress_enrollment_trigger', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  v_new_tags := COALESCE(NEW.tags, '{}');
  v_old_tags := COALESCE(OLD.tags, '{}');
  v_added_tags := ARRAY(SELECT unnest(v_new_tags) EXCEPT SELECT unnest(v_old_tags));

  IF array_length(v_added_tags, 1) IS NULL THEN RETURN NEW; END IF;

  FOREACH v_tag IN ARRAY v_added_tags LOOP
    SELECT * INTO v_tag_config FROM stripe_product_tag_map
    WHERE tag = v_tag AND org_id = NEW.org_id AND creates_participant = true LIMIT 1;

    IF FOUND AND NEW.email IS NOT NULL THEN
      SELECT id INTO v_existing_profile FROM profiles WHERE email = NEW.email LIMIT 1;

      IF v_existing_profile IS NULL THEN
        INSERT INTO pending_participant_creation (contact_id, org_id, email, full_name, enrollment_type, source_tag)
        VALUES (NEW.id, NEW.org_id, NEW.email, CONCAT(COALESCE(NEW.first_name,''), ' ', COALESCE(NEW.last_name,'')), v_tag_config.enrollment_type, v_tag)
        ON CONFLICT (email) DO UPDATE SET updated_at = now(), source_tag = v_tag;
      ELSE
        UPDATE profiles SET role = 'participant'
        WHERE id = v_existing_profile AND role NOT IN ('superadmin', 'admin', 'facilitator');
      END IF;

      UPDATE contacts SET enrollment_type = v_tag_config.enrollment_type
      WHERE id = NEW.id AND (enrollment_type IS NULL OR enrollment_type != v_tag_config.enrollment_type);

      -- FIX: label is NOT NULL and was never supplied. Give the 'enrolled' event
      -- a human-readable label derived from the enrollment type.
      INSERT INTO contact_lifecycle_events (contact_id, org_id, event_type, label, event_value, metadata)
      VALUES (NEW.id, NEW.org_id, 'enrolled', CONCAT('Enrolled: ', v_tag_config.enrollment_type), v_tag_config.enrollment_type,
        jsonb_build_object('source_tag', v_tag, 'auto_created', true));

      INSERT INTO integration_audit_log (source, action, contact_id, org_id, payload, result)
      VALUES ('trigger', 'participant_created', NEW.id, NEW.org_id,
        jsonb_build_object('tag', v_tag, 'email', NEW.email), 'success');
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- ── merge_union_tags: apply the winner's merged tag set with the guard set ───
-- The tags UPDATE is the ONLY thing in a merge that trips the enrollment trigger,
-- so only it needs to run through here. set_config(..., is_local => true) scopes
-- the flag to this function's transaction; the trigger fires in that same
-- transaction and sees it. service_role only (same as merge_contact_repoint).
create or replace function public.merge_union_tags(p_winner uuid, p_tags text[])
 returns void
 language plpgsql
 security definer
 set search_path = public
as $$
begin
  perform set_config('app.suppress_enrollment_trigger', 'on', true);
  update contacts set tags = p_tags where id = p_winner;
end;
$$;

revoke all on function public.merge_union_tags(uuid, text[]) from public;
revoke all on function public.merge_union_tags(uuid, text[]) from anon;
revoke all on function public.merge_union_tags(uuid, text[]) from authenticated;
grant execute on function public.merge_union_tags(uuid, text[]) to service_role;

-- Verification:
--   -- normal tag change still enrolls (label now present):
--   -- (in a scratch tx) update contacts set tags = tags || '{Mastermind}' where ...;
--   --   -> one contact_lifecycle_events row with label 'Enrolled: mastermind'
--   -- merge path stays dormant:
--   --   select public.merge_union_tags('<winner>','{Mastermind}');  -> no lifecycle row
--   select grantee, privilege_type from information_schema.routine_privileges
--    where routine_name='merge_union_tags';   -- expect service_role only
