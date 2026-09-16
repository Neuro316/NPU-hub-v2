import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, getVoiceCallerId } from '@/lib/twilio-org';
import { toE164 } from '@/lib/phone';
import { resolveInboundOrgContext, appendVoicemail, appendRingDial } from '@/lib/inbound-voice';
import {
  findContactByPhoneNormalized, getOrCreateConversation, bumpConversation,
  logActivity, applyAutoAssignment,
} from '@/lib/crm-server';
import twilio from 'twilio';

export async function POST(request: NextRequest) {
  const VoiceResponse = twilio.twiml.VoiceResponse;

  try {
    // Parse form data - Twilio sends application/x-www-form-urlencoded
    let params: Record<string, string> = {};
    try {
      const text = await request.text();
      const searchParams = new URLSearchParams(text);
      searchParams.forEach((val, key) => { params[key] = val; });
    } catch (e) {
      console.error('Failed to parse request body:', e);
    }

    console.log('Inbound call params:', JSON.stringify(params));

    const to = params.To || '';
    const from = params.From || '';

    const response = new VoiceResponse();

    // OUTBOUND: browser dialing a phone number.
    // The reliable signal is the ORIGIN: the Voice SDK always presents the
    // browser leg as From="client:<identity>". Keying off From (not a regex on
    // To) means a formatted "To" like "(828) 348-4022" still routes to <Dial>
    // <Number> instead of falling through to the <Client> branch (which dialed a
    // nonexistent client and returned Busy).
    const isBrowserOriginated = from.toLowerCase().startsWith('client:');
    if (isBrowserOriginated) {
      const dialTo = toE164(to);
      if (!dialTo) {
        console.warn('Outbound call: undialable To:', JSON.stringify(to));
        response.say({ voice: 'Polly.Joanna' }, 'That number could not be dialed. Please check the contact and try again.');
        return new NextResponse(response.toString(), { headers: { 'Content-Type': 'text/xml' } });
      }

      // Caller ID, org-scoped. The authenticated token route already resolved the
      // correct number for THIS contact's org and passed it as CallerId; validate
      // it against that org's own numbers (OrgId param) and fall back within the
      // org — never the old unfiltered .limit(1).single() that could grab another
      // org's config.
      const admin = createAdminSupabase();
      const orgId = (params.OrgId || '').trim();
      let callerId = '';
      try {
        const config = orgId ? await getOrgTwilioConfig(admin, orgId) : null;
        const orgNumbers = new Set((config?.numbers || []).map(n => n.phone));
        const passed = (params.CallerId || '').trim();
        if (passed && (orgNumbers.size === 0 || orgNumbers.has(passed))) {
          callerId = passed;                                   // token-resolved, validated
        } else if (config) {
          // Same resolver as the token route, so the number the browser was told
          // to use and the number this fallback picks can't disagree.
          callerId = getVoiceCallerId(config);
        }
      } catch (e) {
        console.warn('Could not resolve org caller ID:', e);
      }
      if (!callerId) callerId = process.env.TWILIO_PHONE_NUMBER || '';

      console.log('Outbound call - To:', dialTo, 'CallerID:', callerId, 'OrgId:', orgId);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
      const dial = response.dial({
        ...(callerId ? { callerId } : {}),
        ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
      });
      dial.number(dialTo);

      return new NextResponse(response.toString(), {
        headers: { 'Content-Type': 'text/xml' },
      });
    }

    // INBOUND: a real PSTN caller reached one of the org's numbers.
    console.log('Inbound call from:', from, 'to:', to);
    const admin = createAdminSupabase();

    // Org + LINE (which of the org's numbers was dialled) + that line's greeting,
    // ring timeout and forward number, each falling back to the org-level value.
    // Shared with the ring-complete action handler so both sides of the flow
    // read the same config the same way.
    const { orgId, lineE164, greetingUrl, greetingText, forwardNumber, ringTimeoutSeconds } =
      await resolveInboundOrgContext(admin, to);

    // Normalized last-10 contact match (069 rpc) — same as inbound SMS. Exact
    // .eq('phone', from) missed contacts stored in non-E.164 formats (e.g. the
    // Cameron Allen contact is stored "18287347558" but arrives "+18287347558"),
    // which left the call row's contact_id null and made voicemails invisible in
    // the thread (the timeline loads calls by contact_id).
    //
    // ── VISIBILITY FIX ──────────────────────────────────────────────────────
    // A call_log row alone is INVISIBLE in the Conversations pane. The pane is a
    // list of `conversations`; call_logs has no conversation_id and is pulled
    // into a thread by contact_id — so the conversation row is what makes the
    // call appear at all, and the call attaches via the contact that
    // conversation belongs to. Inbound SMS already did find-or-create-contact ->
    // find-or-create-conversation -> bump; inbound calls skipped both, so a call
    // from a number with no prior conversation landed in the DB and showed up
    // nowhere. Mirror the SMS path exactly: unknown caller gets a placeholder
    // "Unknown" contact (mergeable later) rather than contact_id = null.
    let contactId: string | null = null;
    let conversationId: string | null = null;
    if (orgId && from) {
      let contact = await findContactByPhoneNormalized(admin, orgId, from);

      if (!contact) {
        try {
          const assignedTo = await applyAutoAssignment(admin, orgId, { source: 'inbound_call' });
          const { data: newContact } = await admin
            .from('contacts')
            .insert({
              org_id: orgId,
              first_name: 'Unknown',
              last_name: from,
              phone: from,
              source: 'inbound_call',
              assigned_to: assignedTo,
            })
            .select()
            .single();
          contact = newContact;
          if (contact) {
            await logActivity(admin, {
              contact_id: contact.id,
              org_id: orgId,
              event_type: 'contact_created',
              event_data: { source: 'inbound_call', phone: from },
            });
          }
        } catch (e) {
          console.warn('inbound call: unknown-contact create failed:', e);
        }
      }

      contactId = contact?.id ?? null;

      // Find-or-create the voice conversation so this caller is visible in the
      // pane, stamped with the line that was dialled. Never let a failure here
      // block the call — TwiML must still return.
      if (contact) {
        try {
          const conversation = await getOrCreateConversation(admin, contact.id, 'voice', orgId, lineE164 || null);
          conversationId = conversation?.id ?? null;
          await bumpConversation(admin, conversation.id, {
            preview: 'Incoming call',
            direction: 'inbound',
            incrementUnread: true,
            currentUnread: conversation.unread_count || 0,
            lineE164: lineE164 || null,
          });
        } catch (e) {
          console.warn('inbound call: conversation upsert failed:', e);
        }
      }
    }

    // Insert the inbound call row keyed by CallSid so recording-ready can attribute
    // the voicemail back to exactly this call. Insert whenever the org resolved —
    // do NOT gate on CallSid (if it ever comes through empty, gating on it would
    // silently skip the row while the forward still proceeds). external_call_sid is
    // nullable + partial-unique, so a null is fine.
    const callSid = params.CallSid || null;
    if (orgId) {
      try {
        await admin.from('call_logs').insert({
          org_id: orgId,
          contact_id: contactId,
          direction: 'inbound',
          status: 'ringing',
          from_number: from,
          to_number: to,
          external_call_sid: callSid,
          started_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('inbound call_log insert failed:', e);
      }
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
    console.log('Inbound routing:', JSON.stringify({
      orgId, contactId, conversationId, line: lineE164, hasGreeting: !!greetingUrl,
      hasGreetingText: !!greetingText, forwards: !!forwardNumber, ringTimeoutSeconds,
    }));

    // ── RING THE BROWSER (AND THE LINE'S CELL, IF ANY) ───────────────────────
    // Dial the org's registered browser receiver(s). Twilio forks this to EVERY
    // Device registered under the identity and the first to accept wins; if none
    // is registered, or nobody answers within the timeout, the <Dial> ends and
    // Twilio POSTs the outcome to the `action` URL. "Nobody's home" is still
    // detected implicitly — it arrives as DialCallStatus=no-answer rather than
    // as verb fall-through — and /ring-complete sends those callers to
    // voicemail. There is still nothing to query.
    //
    // `action` IS set here, and the reason is subtle — read before changing it.
    // Without an action URL Twilio continues THIS document when the dial ends,
    // identically whether the browser answered or not. So a browser hang-up sent
    // the caller onward into the greeting + <Record>: hanging up promoted the
    // caller to voicemail instead of ending their call. DialCallStatus is the
    // only signal that distinguishes the two, and it exists only with an action.
    //
    // The rule that action must NOT strand the voicemail fallback still holds —
    // it is satisfied by /ring-complete emitting the voicemail TwiML itself on
    // the no-answer branch. That is why the verbs below are now reachable ONLY
    // when no ring leg was dialled at all.
    //
    // The <Dial> itself is built by appendRingDial (inbound-voice.ts), which owns
    // the two shapes: browser-only for a line with no forward_number (the Neuro
    // Progeny main line — no callerId, From intact), and browser + <Number> with
    // callerId = the dialled line for a line that forwards to a cell. The old
    // dormant sequential-forward block that used to sit after this dial is
    // gone: forwarding is real now and lives inside the same <Dial>.
    if (orgId) {
      appendRingDial(response, {
        orgId,
        appUrl,
        // Configurable in CRM Settings -> Twilio, per line or per org; clamped to
        // 5-30s on read so a stray 0 can't silently disable browser ringing.
        ringTimeoutSeconds,
        lineE164,
        forwardNumber,
        callerE164: from,
      });

      // With an action set, everything after this <Dial> is unreachable —
      // ring-complete owns both outcomes. Return now so that is explicit rather
      // than relying on dead verbs being harmless.
      if (appUrl) {
        return new NextResponse(response.toString(), {
          headers: { 'Content-Type': 'text/xml' },
        });
      }
    }

    // Voicemail fallback. Reached only when NO ring leg was dialled (org
    // unresolved), or when no appUrl meant no action URL could be built (the
    // dial above then falls through here on its own). recordingStatusCallback ->
    // recording-ready, which attributes by CallSid and marks the row 'voicemail'.
    // Same voicemail TwiML the action handler emits — one implementation, so the
    // two paths cannot drift.
    appendVoicemail(response, { greetingUrl, greetingText, appUrl });

    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (e: any) {
    console.error('Inbound call route CRASH:', e);
    const response = new VoiceResponse();
    response.say('We are sorry, please try again later.');
    return new NextResponse(response.toString(), {
      headers: { 'Content-Type': 'text/xml' },
    });
  }
}

// Also handle GET in case Twilio sends GET
export async function GET() {
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const response = new VoiceResponse();
  response.say('This endpoint only accepts POST requests.');
  return new NextResponse(response.toString(), {
    headers: { 'Content-Type': 'text/xml' },
  });
}
