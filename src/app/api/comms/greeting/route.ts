import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabase, createServerSupabase } from '@/lib/supabase';
import { ADMIN_ROLES } from '@/lib/org-settings-keys';

// Voicemail greeting management (NPU Hub — Twilio Conversations, Stage 1).
//
// GET    ?org_id=  -> current greeting URL for the org
// POST   multipart -> validate + store audio, save greeting_url on crm_twilio
// DELETE ?org_id=  -> remove greeting, revert callers to the default <Say>
//
// Admin-gated SERVER-SIDE on every verb (getUser -> org_members membership ->
// profiles.role in ADMIN_ROLES), mirroring /api/settings PUT. The CRM settings
// page writes other org_settings straight from the browser; the greeting
// deliberately does NOT — see the security queue.
//
// The stored object is PUBLIC by design: Twilio's servers fetch it
// unauthenticated at call time via <Play>. See 071_comms_greetings_bucket.sql.

const BUCKET = 'comms-greetings';
const MAX_BYTES = 5 * 1024 * 1024;

// Only formats Twilio's <Play> can actually render. WebM/Opus (what
// MediaRecorder produces natively) is absent on purpose — the client transcodes
// recordings to WAV before upload (src/lib/audio-wav.ts).
const ALLOWED: { mime: string[]; ext: 'mp3' | 'wav' }[] = [
  { mime: ['audio/mpeg', 'audio/mp3'], ext: 'mp3' },
  { mime: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'], ext: 'wav' },
];

/**
 * Sniff the real container from the leading bytes. A file renamed .mp3 that is
 * actually Opus passes both the extension and the browser-reported MIME check,
 * uploads happily, and then fails at Twilio with the caller hearing an error —
 * exactly the "unplayable file saved silently" failure this must prevent.
 */
function sniffAudio(buf: Buffer): 'mp3' | 'wav' | null {
  if (buf.length < 12) return null;
  // WAV: "RIFF" .... "WAVE"
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return 'wav';
  }
  // MP3: "ID3" tag, or a raw MPEG frame sync (0xFF Ex/Fx).
  if (buf.toString('ascii', 0, 3) === 'ID3') return 'mp3';
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** getUser -> org membership -> admin role. Returns null when allowed. */
async function requireOrgAdmin(
  admin: ReturnType<typeof createAdminSupabase>,
  orgId: string
): Promise<NextResponse | null> {
  const supabaseUser = createServerSupabase();
  const { data: { user } } = await supabaseUser.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await admin
    .from('profiles').select('role').eq('id', user.id).maybeSingle();
  const role = profile?.role ?? '';

  // superadmin short-circuits the membership check (067 policy shape).
  if (role === 'superadmin') return null;
  if (!ADMIN_ROLES.has(role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { data: membership } = await admin
    .from('org_members').select('id')
    .eq('organization_id', orgId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this organization' }, { status: 403 });
  }
  return null;
}

/** Current crm_twilio setting_value for an org (never null — {} when unset). */
async function readTwilioSettings(
  admin: ReturnType<typeof createAdminSupabase>,
  orgId: string
): Promise<Record<string, any>> {
  const { data } = await admin
    .from('org_settings')
    .select('setting_value')
    .eq('org_id', orgId)
    .eq('setting_key', 'crm_twilio')
    .maybeSingle();
  const v = data?.setting_value;
  return v && typeof v === 'object' && !Array.isArray(v) ? { ...v } : {};
}

export async function GET(request: NextRequest) {
  const orgId = (request.nextUrl.searchParams.get('org_id') || '').trim();
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });

  const admin = createAdminSupabase();
  const denied = await requireOrgAdmin(admin, orgId);
  if (denied) return denied;

  const settings = await readTwilioSettings(admin, orgId);
  return NextResponse.json({
    greeting_url: settings.greeting_url || null,
    greeting_updated_at: settings.greeting_updated_at || null,
    greeting_filename: settings.greeting_filename || null,
  });
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const file = form.get('file') as File | null;
    const orgId = String(form.get('org_id') || '').trim();

    if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });
    if (!file || typeof file.arrayBuffer !== 'function') {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 });
    }

    const admin = createAdminSupabase();
    const denied = await requireOrgAdmin(admin, orgId);
    if (denied) return denied;

    // --- Validation gate 1: size -------------------------------------------
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is ${(file.size / 1048576).toFixed(1)} MB. Maximum is 5 MB.` },
        { status: 400 }
      );
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
    }

    // --- Validation gate 2: declared MIME / extension ------------------------
    const declaredMime = (file.type || '').toLowerCase().split(';')[0].trim();
    const nameExt = (file.name || '').toLowerCase().split('.').pop() || '';
    const byMime = ALLOWED.find(a => a.mime.includes(declaredMime));
    const byExt = ALLOWED.find(a => a.ext === nameExt);
    if (!byMime && !byExt) {
      return NextResponse.json(
        { error: 'Unsupported format. Twilio can only play MP3 or WAV files.' },
        { status: 400 }
      );
    }

    // --- Validation gate 3: magic bytes (authoritative) ----------------------
    const buffer = Buffer.from(await file.arrayBuffer());
    const sniffed = sniffAudio(buffer);
    if (!sniffed) {
      return NextResponse.json(
        {
          error:
            'That file is not a valid MP3 or WAV. (A recording saved as .webm/.ogg/.m4a — even renamed — cannot be played by Twilio.)',
        },
        { status: 400 }
      );
    }

    const ext = sniffed;
    const contentType = ext === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const path = `${orgId}/greeting-${Date.now()}.${ext}`;

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType, upsert: false, cacheControl: '3600' });
    if (uploadError) {
      console.error('[comms/greeting] storage upload failed:', uploadError);
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    const { data: urlData } = admin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = urlData?.publicUrl;
    if (!publicUrl) {
      await admin.storage.from(BUCKET).remove([path]);
      return NextResponse.json({ error: 'Could not resolve public URL' }, { status: 500 });
    }

    // --- READ-MERGE-WRITE ---------------------------------------------------
    // crm_twilio holds account_sid / auth_token / api_secret / twiml_app_sid /
    // numbers. A bare upsert of { greeting_url } would WIPE every credential in
    // this org's Twilio config. Always merge onto the existing object.
    const settings = await readTwilioSettings(admin, orgId);
    const previousPath = typeof settings.greeting_path === 'string' ? settings.greeting_path : '';

    const { error: saveError } = await admin.from('org_settings').upsert(
      {
        org_id: orgId,
        setting_key: 'crm_twilio',
        setting_value: {
          ...settings,
          greeting_url: publicUrl,
          greeting_path: path,
          greeting_filename: file.name || `greeting.${ext}`,
          greeting_updated_at: new Date().toISOString(),
        },
      },
      { onConflict: 'org_id,setting_key' }
    );
    if (saveError) {
      // Roll the object back so storage never holds an orphan the config
      // doesn't point at.
      await admin.storage.from(BUCKET).remove([path]);
      console.error('[comms/greeting] settings save failed:', saveError);
      return NextResponse.json({ error: saveError.message }, { status: 500 });
    }

    // Best-effort cleanup of the replaced greeting (after the pointer moved).
    if (previousPath && previousPath !== path) {
      await admin.storage.from(BUCKET).remove([previousPath]);
    }

    return NextResponse.json({ ok: true, greeting_url: publicUrl, format: ext });
  } catch (e: any) {
    console.error('[comms/greeting] POST error:', e);
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const orgId = (request.nextUrl.searchParams.get('org_id') || '').trim();
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 });

  const admin = createAdminSupabase();
  const denied = await requireOrgAdmin(admin, orgId);
  if (denied) return denied;

  const settings = await readTwilioSettings(admin, orgId);
  const path = typeof settings.greeting_path === 'string' ? settings.greeting_path : '';

  delete settings.greeting_url;
  delete settings.greeting_path;
  delete settings.greeting_filename;
  delete settings.greeting_updated_at;

  const { error } = await admin.from('org_settings').upsert(
    { org_id: orgId, setting_key: 'crm_twilio', setting_value: settings },
    { onConflict: 'org_id,setting_key' }
  );
  if (error) {
    console.error('[comms/greeting] delete save failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (path) await admin.storage.from(BUCKET).remove([path]);

  return NextResponse.json({ ok: true });
}
