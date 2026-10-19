import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase } from '@/lib/supabase';
import { getOrgTwilioConfig, getVoiceCallerId, findOrgNumber } from '@/lib/twilio-org';
import { toE164 } from '@/lib/phone';
import {
  resolveInboundOrgContext, appendVoicemail, appendRingDial, appendRecordingNotice,
} from '@/lib/inbound-voice';
import {
  findContactByPhoneNormalized, getOrCreateConversation, bumpConversation,
  logActivity, applyAutoAssignment,
} from '@/lib/crm-server';
import { validateTwilioSignatureWithToken } from '@/lib/twilio';
import {
  resolveVoiceWebhookAuth, voiceSignatureUrl, voiceSignatureMode,
} from '@/lib/twilio-voice-signature';
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

    // ── Signature verification, LOG ONLY by default ──
    // This route is the entry point for every inbound call on both lines, so a
    // reconstructed-URL or token mismatch would mean silence on the main line
    // rather than a failed background callback. It therefore verifies and LOGS
    // by default, and only rejects when TWILIO_VOICE_SIGNATURE_MODE=enforce.
    //
    // A browser originated leg is signed by Twilio too, but its From is
    // "client:<identity>" and its To is the dialled number, so neither maps to
    // one of our numbers and the org token cannot be resolved. Those fall to the
    // env token; the token_source field in the log says so.
    //
    // Promote to enforce only after the logs show zero mismatches on BOTH lines
    // for inbound and outbound.
    //
    // THE WHOLE CHECK IS WRAPPED. resolveVoiceWebhookAuth reads org_settings and
    // crm_twilio_numbers, so it can throw on a database hiccup, and
    // validateTwilioSignatureWithToken can throw on malformed input. An
    // exception here must not be the reason a live inbound call fails: while the
    // mode is log, a thrown error is logged and the call proceeds exactly as it
    // would have before validation existed. Under enforce it is a 403, because
    // there the operator has chosen to fail closed and an unverifiable request
    // is exactly what that choice is about.
    //
    // voiceSignatureMode() is read OUTSIDE the try: it only reads an env var, and
    // the catch needs it to decide what to do.
    const signatureMode = voiceSignatureMode();
    try {
      const signature = request.headers.get('x-twilio-signature') || '';
      const url = voiceSignatureUrl('/api/twilio/inbound-call');
      const { authToken, source } = await resolveVoiceWebhookAuth(to, from);
      const ok = !!url && !!signature
        && validateTwilioSignatureWithToken(authToken, url, params, signature);
      if (!ok) {
        const forwardedHost = request.headers.get('x-forwarded-host') || request.headers.get('host') || '(none)';
        const forwardedProto = request.headers.get('x-forwarded-proto') || 'https';
        console.error(
          '[inbound-call] SIGNATURE MISMATCH.',
          'mode=', signatureMode,
          '| reconstructed_url=', url || '(NO BASE URL)',
          '| twilio_called_host=', `${forwardedProto}://${forwardedHost}${request.nextUrl.pathname}`,
          '| NEXT_PUBLIC_APP_URL=', process.env.NEXT_PUBLIC_APP_URL || '(UNSET)',
          '| token_source=', source,
          '| has_signature=', !!signature
        );
        if (signatureMode === 'enforce') return new NextResponse('Forbidden', { status: 403 });
      } else {
        console.log('[inbound-call] signature ok, token_source=', source);
      }
    } catch (e: any) {
      console.error('[inbound-call] signature check errored, continuing:', e?.message ?? String(e));
      if (signatureMode === 'enforce') return new NextResponse('Forbidden', { status: 403 });
    }

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
      // Hoisted out of the try so the per line recording flags below can read the
      // same config that resolved the caller ID. Null when the org is unknown or
      // the lookup threw, which leaves recording off.
      let outConfig: Awaited<ReturnType<typeof getOrgTwilioConfig>> | null = null;
      try {
        const config = orgId ? await getOrgTwilioConfig(admin, orgId) : null;
        outConfig = config;
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

      // ── Stamp external_call_sid on the outbound row ──
      // WHY THIS IS NEEDED. recording-ready, ring-complete, transcription and
      // voice/answered all attribute by external_call_sid, and until now only
      // inbound-call ever wrote it. voice/token creates the outbound row BEFORE
      // a call exists, so it has no SID to write, and the row stayed unmatchable:
      // an outbound recording callback would find nothing and no-op.
      //
      // params.CallSid here is the PARENT call, the browser leg, which is the SID
      // a <Dial> recording callback reports. CallLogId is a custom parameter the
      // browser passes to device.connect, the same channel OrgId and CallerId
      // already use, so the row is addressed by id and no lookup heuristic is
      // involved. This deliberately does NOT go through call-status, whose
      // "latest ringing row" query is a known open defect.
      const callLogId = (params.CallLogId || '').trim();
      const parentCallSid = (params.CallSid || '').trim();
      if (callLogId && parentCallSid) {
        try {
          // Verify by ROW COUNT, not by `error`: a filtered update returns error
          // null and zero rows. Guarded on external_call_sid IS NULL so a retry
          // of this webhook cannot overwrite a SID already recorded.
          const { count, error } = await admin
            .from('call_logs')
            .update({ external_call_sid: parentCallSid }, { count: 'exact' })
            .eq('id', callLogId)
            .is('external_call_sid', null);
          if (error) {
            console.warn('outbound sid stamp failed:', error.message);
          } else {
            console.log('outbound sid stamp:', JSON.stringify({
              call_log_id: callLogId, call_sid: parentCallSid, rows_updated: count ?? 0,
            }));
          }
        } catch (e: any) {
          console.warn('outbound sid stamp skipped:', e?.message ?? String(e));
        }
      } else {
        console.warn('outbound sid stamp skipped: missing CallLogId or CallSid', JSON.stringify({
          has_call_log_id: !!callLogId, has_call_sid: !!parentCallSid,
        }));
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');

      // Per line recording for outbound. The line here is the number we are
      // calling FROM, so the flag is read off that number's config. Both
      // switches are absent by default, so an untouched line is unchanged.
      const outLine = (outConfig && callerId) ? findOrgNumber(outConfig, callerId) : null;
      const outRecord = outLine?.record_calls === true && !!appUrl;
      appendRecordingNotice(response, {
        enabled: outLine?.recording_notice_enabled === true,
        text: outLine?.recording_notice_text,
      });

      const dial = response.dial({
        ...(callerId ? { callerId } : {}),
        ...(appUrl ? { action: `${appUrl}/api/twilio/call-status` } : {}),
        ...(outRecord ? {
          record: 'record-from-answer-dual',
          recordingStatusCallback: `${appUrl}/api/twilio/recording-ready`,
          recordingStatusCallbackMethod: 'POST',
        } : {}),
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
    const {
      orgId, lineE164, greetingUrl, greetingText, forwardNumber, ringTimeoutSeconds,
      recordCalls, recordingNoticeEnabled, recordingNoticeText,
    } = await resolveInboundOrgContext(admin, to);

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
      // Notice before the dial so the caller hears it on our leg. Off by default.
      appendRecordingNotice(response, {
        enabled: recordingNoticeEnabled,
        text: recordingNoticeText,
      });
      appendRingDial(response, {
        orgId,
        appUrl,
        recordCalls,
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
