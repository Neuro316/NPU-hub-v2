import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, createAdminSupabase } from '@/lib/supabase';
import { resolveMergeTags } from '@/lib/crm-server';

// ─── POST /api/crm/stage-emails ───
// Fires the emails configured on a pipeline stage. Called from the Pipelines
// board when a card is moved into a stage.
//
// ── SEND GUARD (migration 077) ─────────────────────────────────────────────
// Dragging a card out of a stage and back in used to re-send. The guard is a
// CLAIM, not a check: we INSERT into stage_email_sends BEFORE calling the Apps
// Script webhook, and only send if that insert won the unique index. A
// check-then-send would be raced by two fast drags — both would read "not sent"
// and both would send. The DB arbitrates, not the client.
//
// The claim is keyed on (contact_id, stage_id, email_id) — stable ids from the
// pipeline JSON, never the stage's display name. Renaming a stage must not
// re-arm every email on it.
//
// A 'failed' claim does not block a retry (partial unique index covers only
// 'sending' and 'sent'), so one transient webhook error can't permanently bar a
// contact from an email.

// A claim left 'sending' by a crashed request would block that pairing forever.
// Anything older than this is treated as dead and released before we claim.
const STALE_CLAIM_MINUTES = 15;

export async function POST(request: NextRequest) {
  const supabase = createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const { org_id, contact_id, emails, pipeline_id, stage_id } = body;
  // Deliberate re-send (a future "resend" button). Without this there is no way
  // to send the same stage email to the same contact twice on purpose.
  const force = body?.force === true;

  if (!org_id || !contact_id || !Array.isArray(emails) || emails.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }
  // The guard cannot key on anything else, so refuse rather than silently
  // sending unguarded.
  if (!pipeline_id || !stage_id) {
    return NextResponse.json(
      { error: 'pipeline_id and stage_id are required (send guard keys on them)' },
      { status: 400 }
    );
  }

  // The ledger is service-role only (077) — a browser-writable ledger could be
  // used to pre-claim a slot and suppress a real send.
  const admin = createAdminSupabase();

  // contact
  const { data: contact } = await supabase.from('contacts').select('*').eq('id', contact_id).single();
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  // stage email script config (Apps Script URL + secret)
  const { data: setting } = await supabase.from('org_settings').select('setting_value').eq('org_id', org_id).eq('setting_key', 'stage_email_script').single();
  const cfg = setting?.setting_value as any;
  if (!cfg?.url || !cfg?.enabled) return NextResponse.json({ error: 'Stage email script not configured' }, { status: 400 });

  // org name for merge tags
  const { data: org } = await supabase.from('organizations').select('name').eq('id', org_id).single();
  const senderName = cfg.sender_name || 'Cameron Allen';

  // ── Step 0: release dead claims ──────────────────────────────────────────
  // Scoped to this contact+stage so a stuck row elsewhere is left alone.
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000).toISOString();
  await admin
    .from('stage_email_sends')
    .update({ status: 'failed', error_message: `stale claim released after ${STALE_CLAIM_MINUTES}m` })
    .eq('contact_id', contact_id)
    .eq('stage_id', stage_id)
    .eq('status', 'sending')
    .lt('claimed_at', staleBefore);

  let sent = 0;
  const results: any[] = [];

  for (const em of emails) {
    try {
      if (!em?.id) { results.push({ skip: 'email has no id — cannot guard' }); continue; }

      // ── Resolve the recipient BEFORE claiming, so a skip doesn't burn a slot.
      let toEmail: string | null = null;
      let assignedName = '';
      if (em.recipient === 'internal') {
        if (!em.team_id) { results.push({ email_id: em.id, skip: 'no team_id' }); continue; }
        const { data: tp } = await supabase.from('team_profiles').select('email,display_name').eq('id', em.team_id).single();
        toEmail = tp?.email || null;
        assignedName = tp?.display_name || '';
      } else {
        if (!contact.email) { results.push({ email_id: em.id, skip: 'no client email' }); continue; }
        if (contact.email_consent === false) { results.push({ email_id: em.id, skip: 'no client consent' }); continue; }
        toEmail = contact.email;
      }
      if (!toEmail) { results.push({ email_id: em.id, skip: 'no recipient email' }); continue; }

      // ── Claim the slot. This is the guard. ─────────────────────────────────
      // On force, retire any existing claim first so the insert can win.
      if (force) {
        await admin
          .from('stage_email_sends')
          .update({ status: 'failed', error_message: 'superseded by force re-send' })
          .eq('contact_id', contact_id)
          .eq('stage_id', stage_id)
          .eq('email_id', em.id)
          .in('status', ['sending', 'sent']);
      }

      const { data: claim, error: claimError } = await admin
        .from('stage_email_sends')
        .insert({
          org_id,
          contact_id,
          pipeline_id,
          stage_id,
          email_id: em.id,
          recipient: em.recipient === 'internal' ? 'internal' : 'client',
          to_email: toEmail,
          status: 'sending',
        })
        .select('id')
        .single();

      if (claimError) {
        // 23505 = unique violation = already sent or in flight. This is the
        // guard doing its job, not an error.
        if ((claimError as any).code === '23505') {
          results.push({ email_id: em.id, skip: 'already_sent' });
        } else {
          console.error('[stage-emails] claim failed:', claimError);
          results.push({ email_id: em.id, error: `claim failed: ${claimError.message}` });
        }
        continue;
      }

      // ── Send ───────────────────────────────────────────────────────────────
      const subject = resolveMergeTags(em.subject || '', contact, org?.name, assignedName);
      const bodyHtml = resolveMergeTags(em.body || '', contact, org?.name, assignedName);

      let result: any;
      try {
        const resp = await fetch(cfg.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'sendEmail', to: toEmail, subject, body_html: bodyHtml, senderName, secret: cfg.secret }),
        });
        result = await resp.json().catch(() => ({ success: false, error: 'bad response' }));
      } catch (e: any) {
        // A throw here previously skipped the log entirely, which is why a
        // failed send left no trace. Release the claim so a retry is possible.
        result = { success: false, error: e?.message || String(e) };
      }

      // ── Finalize the claim ─────────────────────────────────────────────────
      await admin
        .from('stage_email_sends')
        .update({
          status: result.success ? 'sent' : 'failed',
          external_message_id: result.provider_message_id || null,
          error_message: result.success ? null : (result.error || 'send failed'),
          sent_at: result.success ? new Date().toISOString() : null,
        })
        .eq('id', claim.id);

      // Reporting log. MUST use the admin client: email_sends has RLS with a
      // single policy (email_sends_via_campaign) that only admits rows tied to a
      // campaign. A stage email has campaign_id NULL, so the anon/authenticated
      // client is rejected — and because the error was never checked, every
      // stage email sent successfully while leaving no trace in email_sends.
      // That is why this table was empty after a confirmed delivery.
      const { error: logError } = await admin.from('email_sends').insert({
        contact_id,
        status: result.success ? 'sent' : 'failed',
        external_message_id: result.provider_message_id || null,
        error_message: result.error || null,
        sent_at: result.success ? new Date().toISOString() : null,
      });
      if (logError) console.error('[stage-emails] email_sends log failed:', logError);

      if (result.success) sent++;
      results.push({ email_id: em.id, to: toEmail, recipient: em.recipient, success: !!result.success, error: result.error });
    } catch (e: any) {
      results.push({ email_id: em?.id, error: e?.message || String(e) });
    }
  }

  return NextResponse.json({ ok: true, sent, results });
}
