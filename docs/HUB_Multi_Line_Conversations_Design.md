# NPU Hub: Multi-Line Conversations (Neuro Progeny + Waynesville Neuro Wellness)

Branch: `feat/multi-line-conversations` · Status: **DESIGN, awaiting approval. No migration file
written, no SQL run, no application code edited.**

Written 2026-09-16 from the tree at `0ae031e` (main). Everything below was read from source and
migrations; nothing was queried from the live database.

---

## §0 Scope and the non-negotiable

Two Twilio numbers live in the Neuro Progeny org's `crm_twilio.numbers`:

| Line | E.164 | Today |
|---|---|---|
| Neuro Progeny main | `+18284155050` | Rings the Hub browser receiver, falls to the org voicemail greeting. |
| Waynesville Neuro Wellness office | `+18289009821` | Voice webhook points at a Twilio Function (`wnw-phone` `/incoming`), not the Hub. SMS already lands in the Hub. |

Goal: a line dropdown in Conversations that filters threads by line and is the From on replies and
callbacks; per-line greeting, ring timeout and cell forwarding so WNW gets its own voicemail box
that lands in the Hub.

**Non-negotiable:** nothing about `+18284155050`'s behavior changes. Every branch below is written so
the NP line takes the *unchanged* path whenever its per-line config is empty, and it will be empty.
Existing rows backfill to the NP line; anything with no line specified defaults to NP.

Migration 069 seeded `crm_twilio_numbers` with `+18289009821` as `friendly_name='Campaign'`,
`purpose='outreach'`. That row predates the number becoming the WNW office line. The nickname shown
in the dropdown comes from `crm_twilio.numbers[].nickname` (org_settings), which is what the
Settings page edits, so the seed label does not leak into the UI. See §12 for the purpose caveat.

---

## §1 Storage

### 1.1 Proposed column

```
conversations.line_e164  text  NULL
```

One nullable text column, CHECK-constrained to E.164 shape, indexed with `org_id`. NULL means "the
org's default line" (resolved in code by `getVoiceCallerId`), which is how every row created by a
path that is not line-aware (email sends, sequence steps, scheduled SMS) keeps working without being
touched. For the NP org the backfill writes the NP number explicitly, so NULL only remains on rows
in orgs with no Twilio numbers (Sensorium).

### 1.2 What the per-event tables already carry (confirmed from migrations)

| Table | Columns | Source | Inbound line | Outbound line |
|---|---|---|---|---|
| `crm_messages` | `from_e164`, `to_e164` | added in 068 | `to_e164` (set by inbound-sms) | `from_e164` (set to `twilioMsg.from`, usually null at insert, filled by `/api/twilio/message-status`) |
| `call_logs` | `from_number`, `to_number` | pre-068 ("already has", 068 header) | `to_number` (set by inbound-call) | `from_number`: **never written today** |

**No new columns are needed on `crm_messages` or `call_logs`.** The line of any event is derivable:

```
lineOf(message) = direction === 'inbound' ? to_e164  : from_e164
lineOf(call)    = direction === 'inbound' ? to_number : from_number
```

Gap found: `/api/voice/token` inserts the outbound `call_logs` row with only `conversation_id,
contact_id, direction, status, called_by, started_at`. No `org_id`, no `from_number`, no `to_number`.
(`called_by` is also silently discarded; `voice/answered` documents that.) Two consequences:

- Outbound calls have no derivable line, so they backfill to the NP default. Correct for history,
  since every outbound call to date went out from `getVoiceCallerId`.
- Outbound call rows have NULL `org_id`, and the 067 policy scopes `call_logs` on `org_id IN
  (user_org_ids())`, so non-superadmin staff cannot see them. Pre-existing, noted, and the §4 change
  fixes it going forward by stamping `org_id`, `from_number`, `to_number` on that insert.

### 1.3 Backfill rule

For each conversation, take the most recent event across texts and calls, derive its line with the
rule above, and keep it only if it is one of the org's own numbers (join to `crm_twilio_numbers` on
`org_id`), so a contact's own number can never be stamped as a line. Then set every remaining NULL
in the NP org to `+18284155050`. Exact SQL in §7.

`call_logs` has no `conversation_id` on inbound rows (inbound-call never sets it), so calls join to
conversations through `contact_id`, exactly as `buildTimeline` does.

---

## §2 Per-number config (JSON, no schema change)

Each entry of `crm_twilio.numbers` (in `org_settings.setting_value`) gains optional keys:

```jsonc
{
  "phone": "+18289009821",
  "nickname": "WNW Office",
  "purpose": "outreach",
  // new, all optional
  "greeting_url": "https://…/comms-greetings/<org>/18289009821/greeting-….wav",
  "greeting_path": "<org>/18289009821/greeting-….wav",
  "greeting_filename": "wnw.wav",
  "greeting_updated_at": "2026-09-16T…",
  "greeting_text": "Thank you for calling Waynesville Neuro Wellness. …",
  "ring_timeout_seconds": 15,
  "forward_number": "+1828XXXXXXX"
}
```

The NP entry gets none of these, so it resolves to the org-level values exactly as today.

### 2.1 `resolveInboundOrgContext(admin, to)` returns an extended `InboundOrgContext`

```ts
export interface InboundOrgContext {
  orgId: string | null;
  lineE164: string;          // the matched number, '' when unmatched
  lineNickname: string;
  greetingUrl: string;       // line value, else org value
  greetingText: string;      // line value only (there is no org-level text today)
  forwardNumber: string;     // line value, else org value (org value is '' in practice)
  ringTimeoutSeconds: number;// clampRingTimeout(line value ?? org value)
}
```

Resolution per field: `numbers[i].<key>` when present and non-empty, else `setting_value.<key>`, else
the existing default. `clampRingTimeout` stays the single authority for the timeout range (5 to 30s).
The https-only guard on `greeting_url` applies to the line value too.

Matching: today it is `n.phone === to`. I propose comparing `toE164(n.phone) === toE164(to)` so a
number typed as `(828) 900-9821` in Settings still matches. This is a superset of current behavior;
`+18284155050` stored as-is matches either way.

`getOrgTwilioConfig` widens the `numbers` element type to carry the optional keys; nothing else in
`twilio-org.ts` reads them.

---

## §3 Inbound stamping, and why a524d17 still holds across lines

### 3.1 What changes

- `getOrCreateConversation(supabase, contactId, channel, orgId?, lineE164?)`: on **create**, insert
  `line_e164`. On an existing row it does nothing (the bump below owns updates).
- `bumpConversation(supabase, id, { …, lineE164? })`: when provided, sets `line_e164`. So
  `line_e164` always records the **most recent** line the contact used.
- `inbound-call` and `inbound-sms` pass `To` (normalised with `toE164`) to both calls.
- `recording-ready` and `voice/answered` pass the call row's `to_number` (they already read the row
  by CallSid), so a voicemail bump cannot un-stamp the line.
- Per-event line stays on `crm_messages` / `call_logs` as it does today (§1.2). Nothing else.

### 3.2 One conversation per contact, still

a524d17's diagnosis was that the match key `contact_id + channel` produced several cards for one
person that never merged, and that the contact-card panel already unified everything by contact.
Both facts are independent of which number the person dialled:

- A person who texts the WNW office and later calls the NP main line is still one person; two cards
  would reintroduce the exact "several cards for the same person" report the commit fixed.
- `buildTimeline` pulls texts by `conversation_id` (Conversations pane) or by contact (contact card),
  and calls always by `contact_id`. A per-line split would make the pane and the card disagree
  again, which a524d17 called out as the only place fragmentation ever lived.
- The `.order(created_at).limit(1)` oldest-first matcher is what stops duplicates compounding; adding
  `line_e164` to the key would need a new dedupe migration and a second `.limit(1)` invariant.

The one thing per-line splitting would buy is a thread that appears under **both** lines when the
contact used both. The per-event line on messages and calls gives the badge that information
without a split, and the list filter can be widened later (§5.2, decision D2) without a schema
change. So: **no per-line conversation splitting.**

---

## §4 Outbound

### 4.1 `/api/sms/send`

Request body gains optional `line_e164`. Server validates it is one of the org's numbers
(`config.numbers`, compared with `toE164`); an unknown value is a 400, never silently ignored.

`sendOrgSms(config, to, body, context, stage, { from?: string })`:

```ts
if (opts.from) {
  params.from = opts.from;
  if (config.messaging_service_sid) params.messagingServiceSid = config.messaging_service_sid;
} else if (config.messaging_service_sid) {
  params.messagingServiceSid = config.messaging_service_sid;      // unchanged path
} else if (fromNumber) {
  params.from = fromNumber;                                         // unchanged path
}
```

**Messaging Service interaction** (Twilio Message resource docs): when both `MessagingServiceSid`
and `From` are given, "the `From` parameter must be a sender from your Messaging Service's Sender
Pool", and the message's initial status is `queued` rather than `accepted`. `/api/twilio/message-status`
maps both to `queued`, so nothing downstream changes. If the chosen number is **not** in the pool
Twilio rejects the send (error 21712), which `sms/send` already surfaces as a 500 with the message.

**Deliverability caveat.** US A2P 10DLC registration is attached to the Messaging Service's campaign,
and numbers are registered by being in that service's sender pool. Therefore:

1. `+18289009821` must be in the NP org's Messaging Service sender pool, or explicit-From sends from
   the WNW line will be rejected (21712) or, if sent without the service SID, risk `30034`
   (unregistered) filtering. The Hub already records `error_code` from status callbacks, so a 30034
   would be visible on the message row.
2. If both numbers are in the pool, the service's Sticky Sender may already be answering NP contacts
   from the WNW number on today's un-pinned sends. This is a Twilio-console fact I cannot read from
   the repo; **check the pool before go-live** (§12, D1).
3. The other two SMS senders (`/api/sequences/process-step`, `/api/sms/process-scheduled`) use the
   global `sendSms` with the env Messaging Service and remain **not line-aware**. Out of scope.

When `line_e164` is present the `crm_messages` insert writes `from_e164 = line` immediately (the
sender is known), and message-status still overwrites it with Twilio's authoritative value.

### 4.2 `/api/voice/token`

Body gains optional `line_e164`. `callerId = (line in org numbers) ? line : getVoiceCallerId(config)`.
The response already returns `caller_id`; `VoipCall` already forwards it as `CallerId` and
`inbound-call`'s browser-originated branch already validates `CallerId` against the org's numbers
and falls back to `getVoiceCallerId`. **No change to that branch.**

Additive fix in the same route: the outbound `call_logs` insert also writes `org_id: contact.org_id`,
`from_number: callerId`, `to_number: toE164(contact.phone)` (§1.2).

`VoipCall` gets an optional `lineE164` prop and posts it. `ContactCommsButtons` (contact card) does
not pass one, so contact-card calls are unchanged.

---

## §5 UI

### 5.1 Line dropdown

Top of the Conversations pane, above search: `All lines`, then each org number as
`nickname` (`(828) 900-9821` in the option title). Selection persists in
`localStorage['npu_hub_conversations_line:' + orgId]` as `'all'` or the E.164; a stored value that
is no longer one of the org's numbers falls back to `'all'`.

The numbers list must **not** come from a browser read of `crm_twilio` (credential-bearing key;
`org-settings-keys.ts` admin-gates it, and facilitators use Conversations). New read-only route
`GET /api/comms/lines?org_id=` returns `{ default_line, lines: [{ phone, nickname, purpose }] }`
only, gated like `caller-lookup` (staff role + membership). Used by the pane, the contact card panel
and the incoming call modal. `default_line` is computed server-side with `getVoiceCallerId` so the
client never re-implements the chain.

### 5.2 Thread list filter

`All lines`: query unchanged. A specific line `L`:

```ts
q = q.eq('line_e164', L)
// when L is the org default line, NULL rows belong to it too:
if (L === defaultLine) q = q.or(`line_e164.eq.${L},line_e164.is.null`)
```

### 5.3 Badge

Small pill with the nickname on each thread row (from `line_e164`), on voicemail and missed-call
rows in the timeline (from the call's `to_number`), and in the contact card comms panel.
`TimelineEntry` gains `line_e164: string | null`; `TimelineStream` gains an optional
`lineLabel?: (e164: string) => string | null` resolver. When the resolver returns null (unknown
number, or an org with one line) no badge renders, so Sensorium's UI is byte-identical.

### 5.4 Reply box and callback

```
effectiveLine = selectedLine !== 'all' ? selectedLine : (thread.line_e164 ?? null)
```

Sent as `line_e164` to `/api/sms/send` and, via `VoipCall`, to `/api/voice/token`. `null` means the
server takes its unchanged path (`getVoiceCallerId` for voice, the Messaging Service for SMS).
The composer shows "Sending as <nickname>" under the textarea so the operator can see which line a
reply will leave from.

### 5.5 Incoming call modal

Shows the line nickname when the ringing call carries a `line` custom parameter (§9.2). The NP
line's TwiML gains that one inert `<Parameter>` only if D3 is approved; otherwise NP calls show
no badge and behave exactly as today.

---

## §6 Settings (CRM Settings > Twilio)

The numbers editor becomes one card per number with a disclosure "Line options":

| Field | Control | Empty state |
|---|---|---|
| Greeting audio | `VoicemailGreeting` with a new `lineE164` prop | "Using org default greeting" |
| Greeting text | textarea, max 500 chars | "Using org default (or spoken default)" |
| Ring timeout | same slider, plus a "Use org default" checkbox that clears the value | "Org default: N s" |
| Forward to cell | text input validated with `toE164`, "Off" when empty | "Off: rings the Hub only" |

`/api/comms/greeting` gains an optional `line` query/form field. With it, GET/POST/DELETE operate on
`numbers[i]` (matched by `toE164`) instead of the top-level keys, and the storage path is
`${orgId}/${digits}/greeting-${ts}.${ext}`. Without it, the route is unchanged. The bucket, size,
MIME and magic-byte gates are reused verbatim.

**Clobber hazard, must be handled:** the page's Save does read-merge-write on the top-level object
but then overwrites `numbers` with its in-memory array, so a greeting uploaded to a line after the
page loaded would be dropped by the next Save. Fix in the same change: on Save, re-read `numbers`
and, per phone, carry the four `greeting_*` keys forward from the fresh read. The org-level
`ring_timeout_seconds` slider stays where it is and keeps its meaning (the fallback).

---

## §7 Migration SQL (proposal only, not created)

File would be `supabase/migrations/207_conversations_line_e164.sql` (Hub band, 200+; 206 is the
current max in this tree; the platform tree is at 180).

```sql
-- 207_conversations_line_e164.sql
-- Multi-line Conversations: which org number a thread most recently used.
-- Additive, nullable, no default -> no table rewrite. RLS untouched: 067's
-- conversations_staff_org_rls is column-agnostic and already has WITH CHECK.
-- Applied via MCP apply_migration (own transaction). In the SQL Editor wrap in
-- BEGIN; ... COMMIT;.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS line_e164 text;

COMMENT ON COLUMN public.conversations.line_e164 IS
  'E.164 of the org''s own Twilio number this thread most recently used '
  '(inbound: the dialled/texted number; outbound: the From). NULL = the org''s '
  'default line as resolved by getVoiceCallerId(). Per-event line lives on '
  'crm_messages.to_e164/from_e164 and call_logs.to_number/from_number.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conname = 'conversations_line_e164_check'
      AND c.conrelid = 'public.conversations'::regclass
  ) THEN
    ALTER TABLE public.conversations
      ADD CONSTRAINT conversations_line_e164_check
      CHECK (line_e164 IS NULL OR line_e164 ~ '^\+[1-9][0-9]{6,14}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_org_line
  ON public.conversations (org_id, line_e164);

-- ---------------------------------------------------------------------------
-- Backfill 1: most recent event per conversation, kept only when the derived
-- number is one of the SAME org's Twilio numbers.
-- DRY RUN first (expect a small count; every row must be in org ...0001):
--   WITH ... (same CTEs) SELECT r.conversation_id, r.line FROM ranked r
--   JOIN public.conversations cv ON cv.id = r.conversation_id
--   WHERE r.rn = 1 AND cv.line_e164 IS NULL;
-- ---------------------------------------------------------------------------
WITH msg AS (
  SELECT m.conversation_id,
         CASE WHEN m.direction = 'inbound' THEN m.to_e164 ELSE m.from_e164 END AS line,
         COALESCE(m.sent_at, m.created_at) AS at
  FROM public.crm_messages m
),
calls AS (
  SELECT cv.id AS conversation_id,
         CASE WHEN cl.direction = 'inbound' THEN cl.to_number ELSE cl.from_number END AS line,
         cl.started_at AS at
  FROM public.call_logs cl
  JOIN public.conversations cv ON cv.contact_id = cl.contact_id
),
events AS (
  SELECT * FROM msg
  UNION ALL
  SELECT * FROM calls
),
ranked AS (
  SELECT e.conversation_id, e.line,
         row_number() OVER (PARTITION BY e.conversation_id ORDER BY e.at DESC) AS rn
  FROM events e
  JOIN public.conversations cv ON cv.id = e.conversation_id
  JOIN public.crm_twilio_numbers n
    ON n.phone_e164 = e.line AND n.org_id = cv.org_id
  WHERE e.line IS NOT NULL
)
UPDATE public.conversations cv
SET line_e164 = r.line
FROM ranked r
WHERE r.conversation_id = cv.id
  AND r.rn = 1
  AND cv.line_e164 IS NULL;

-- ---------------------------------------------------------------------------
-- Backfill 2: everything else in the Neuro Progeny org is the NP main line.
-- Other orgs stay NULL (= their default line), because stamping an NP number
-- onto a Sensorium thread would be wrong.
-- DRY RUN: SELECT count(*) FROM public.conversations cv
--          WHERE cv.org_id = '00000000-0000-0000-0000-000000000001'
--            AND cv.line_e164 IS NULL;
-- ---------------------------------------------------------------------------
UPDATE public.conversations cv
SET line_e164 = '+18284155050'
WHERE cv.org_id = '00000000-0000-0000-0000-000000000001'
  AND cv.line_e164 IS NULL;

-- ---------------------------------------------------------------------------
-- No RLS change. If conversations_staff_org_rls is ever recreated it must keep
-- an explicit WITH CHECK (067 shape); this migration does not touch it.
-- ---------------------------------------------------------------------------

-- POST-APPLY PROBES (pg_catalog, not information_schema)
-- P1 column exists, nullable text:
--   SELECT a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), a.attnotnull
--   FROM pg_catalog.pg_attribute a
--   JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
--   JOIN pg_catalog.pg_namespace ns ON ns.oid = c.relnamespace
--   WHERE ns.nspname = 'public' AND c.relname = 'conversations'
--     AND a.attname = 'line_e164' AND NOT a.attisdropped;
--   -- expect: line_e164 | text | f
-- P2 index + check present:
--   SELECT ic.relname FROM pg_catalog.pg_index i
--   JOIN pg_catalog.pg_class ic ON ic.oid = i.indexrelid
--   WHERE i.indrelid = 'public.conversations'::regclass
--     AND ic.relname = 'idx_conversations_org_line';
--   SELECT c.conname FROM pg_catalog.pg_constraint c
--   WHERE c.conrelid = 'public.conversations'::regclass
--     AND c.conname = 'conversations_line_e164_check';
-- P3 distribution:
--   SELECT cv.org_id, cv.line_e164, count(*) FROM public.conversations cv
--   GROUP BY 1, 2 ORDER BY 1, 2;
--   -- expect: every ...0001 row non-null (5050 or 9821); other orgs NULL.
-- P4 policy still carries WITH CHECK:
--   SELECT p.polname, (p.polwithcheck IS NOT NULL) AS has_with_check
--   FROM pg_catalog.pg_policy p
--   WHERE p.polrelid = 'public.conversations'::regclass;
```

Also proposed, same migration or a separate one-liner, **only if you want the seed label to match
reality** (it is not read by the UI):

```sql
UPDATE public.crm_twilio_numbers n
SET friendly_name = 'WNW Office'
WHERE n.phone_e164 = '+18289009821';
```

`purpose` is deliberately left alone (§12, D4).

---

## §8 Regression checklist

Run after deploy, NP first, with the browser receiver enabled in one tab.

1. **Inbound call to `+18284155050`**: browser rings within ~2s; modal shows the real caller's
   number/name (From intact, no `callerId`); TwiML on the wire is `<Dial timeout=20
   action=ring-complete><Client>org-…</Client></Dial>` and nothing else. Conversation row gets
   `line_e164='+18284155050'`, call row `to_number='+18284155050'`.
2. **Inbound call to `+18289009821`**: browser rings **and** the forward cell rings at the same time;
   cell's screen shows `(828) 900-9821`; modal shows the true caller (from `caller` parameter) and a
   "WNW Office" badge; conversation `line_e164='+18289009821'`.
3. **Browser answers on either line, then hangs up**: caller's call ends (`DialCallStatus=completed`
   then `<Hangup/>`), no voicemail (2d1e9da preserved).
4. **Cell answers WNW, then hangs up**: same as 3.
5. **No answer, NP**: after ~25s (20 + Twilio's 5s buffer) the caller hears the org greeting
   (`<Play>` if set, else the existing `Polly.Joanna` default), beep, records.
6. **No answer, WNW**: after ~20s (15 + 5) the caller hears the WNW text via `Polly.Joanna-Neural`
   (or the WNW audio greeting once uploaded), beep, records. Cell must **not** have gone to carrier
   voicemail first; if it did, lower the timeout (§9.4).
7. **recording-ready + transcription**: voicemail attaches to the right call row by CallSid on
   both lines; the thread bump keeps `line_e164`; the voicemail card shows the line badge.
8. **Inbound SMS to each number**: message `to_e164` is the dialled number; thread stamped; STOP
   still opts the contact out across both lines.
9. **Outbound SMS from each line** (dropdown set): Twilio log shows the chosen From; `from_e164`
   set at insert and confirmed by message-status; `All lines` on an NP-stamped thread sends from NP
   (explicit) and on a NULL-stamped thread takes the unchanged Messaging Service path.
10. **Outbound call from each line**: cell/phone shows the chosen number; `call_logs` row has
    `org_id`, `from_number`, `to_number`.
11. **Line filter**: NP shows NP + NULL rows in the NP org; WNW shows only `+18289009821`; badge
    matches; selection survives reload and is per org.
12. **Sensorium org**: no dropdown line entries beyond `All lines` (or none rendered when the org
    has zero numbers), no badges, Settings > Twilio identical, inbound unchanged.
13. **Decline in browser** on both lines goes to voicemail (`no-answer`/`canceled` branch, unchanged).
14. Settings: upload a WNW greeting, then Save Settings on the Twilio tab; the greeting survives
    (§6 clobber fix).

---

## §9 Per-line forwarding (replaces the `wnw-phone` Twilio Function)

### 9.1 Cutover

In the Twilio console, point `+18289009821`'s Voice "A call comes in" webhook at
`https://hub.neuroprogeny.com/api/twilio/inbound-call` (POST). Leave the Function deployed but
unattached as the rollback. I cannot see the Function's source from this repo, so anything it did
beyond ring-the-cell-then-voicemail (an announcement, business hours) is lost unless you tell me.

Note while here: `inbound-call` does **not** validate the Twilio signature (`inbound-sms` and
`message-status` do). Pre-existing; not changed by this work; worth a follow-up.

### 9.2 TwiML for a line with `forward_number`

```xml
<Dial timeout="15" action="https://hub…/api/twilio/ring-complete" method="POST"
      callerId="+18289009821">
  <Client>
    <Identity>org-00000000-0000-0000-0000-000000000001</Identity>
    <Parameter name="caller" value="+1828XXXXXXX"/>
    <Parameter name="line"   value="+18289009821"/>
  </Client>
  <Number>+1828YYYYYYY</Number>
</Dial>
```

- Simultaneous ring. Twilio's `<Number>` reference: "The first call to pick up is connected to the
  current call and the rest are hung up." Up to ten nouns per `<Dial>`. The reference documents this
  for `<Number>` nouns; `<Client>` is a peer noun of the same verb and Twilio's own examples mix them,
  but item 2 of §8 is the proof.
- `callerId`. Twilio's `<Dial>` reference says the dialled party sees the inbound caller's number by
  default, and that `callerId` may be "either the To or From number provided in Twilio's TwiML
  request" or any purchased number. Setting it to the dialled WNW number makes the cell show a
  business call. **It applies to the whole `<Dial>`**, so the browser leg's `From` becomes
  `+18289009821` too, which is exactly why fe9dabc/2d1e9da set none. The `caller` `<Parameter>`
  carries the true caller to the browser; `voice-receiver-context` reads
  `call.customParameters.get('caller')` first and falls back to `call.parameters.From`, so the NP
  path (no parameter) is unchanged and `caller-lookup` still names the right person.
- A line **without** `forward_number` emits today's TwiML unchanged: no `callerId`, `<Client>` only,
  its own `ring_timeout_seconds` (org fallback = 20). The NP line is this case.

### 9.3 `ring-complete` and DialCallStatus

Unchanged branch logic. With a mixed dial, `DialCallStatus` reports the outcome of the `<Dial>`:
`completed` when *any* leg answered and the call ended (browser or cell), which hits the existing
`<Hangup/>` branch; `no-answer` / `busy` / `failed` / `canceled` when nothing answered, which hits
`appendVoicemail`. The 2d1e9da fix is therefore preserved for both legs. Twilio's `<Dial>` reference
does not spell out per-leg attribution for simultaneous dials, which is why §8 items 3 and 4 are
both on the list.

Two small additions in `ring-complete`:
- It calls the extended `resolveInboundOrgContext(admin, To)` and passes `greetingText` through.
- On `completed` it updates the `call_logs` row by `CallSid` to `status='completed'` **unless**
  `/voice/answered` already marked it (so a cell-answered call no longer sits at `ringing` forever).
  Optional later: `<Number statusCallback statusCallbackEvent="answered">` to a new route keyed by
  `ParentCallSid` to record "answered on cell" (`call-status` cannot be reused: it picks the latest
  `ringing` row, not the CallSid).

### 9.4 Carrier-voicemail caveat

Twilio adds ~5s to any `timeout`, so `15` rings the cell for ~20s. Most US carriers hand an
unanswered cell to carrier voicemail at 20 to 30s. If the carrier answers first, Twilio sees an
*answered* leg: the caller records onto the **cell's** voicemail, `DialCallStatus=completed`, and
the Hub never gets the message. Rules:

- WNW `ring_timeout_seconds = 15` is the ceiling; drop to 12 if §8 item 6 ever lands on the carrier
  box. The Settings copy says this next to the forward field.
- A switched-off or out-of-coverage cell answers with carrier voicemail *immediately*. Mitigation
  options, both optional and both to be verified by a test call before relying on them:
  `<Number url="…/forward-screen">` playing "Press 1 to accept" with a `<Gather>` (a carrier box
  never presses 1, and Twilio's `<Number url>` TwiML may `<Hangup/>` to reject the leg), or
  `<Number machineDetection="Enable">` (documented on `<Number>`; billed per detection).

### 9.5 `appendVoicemail` with greeting text

```ts
appendVoicemail(response, { greetingUrl, greetingText, appUrl })
// greetingUrl  -> <Play>                                   (unchanged)
// greetingText -> <Say voice="Polly.Joanna-Neural">text</Say>
// neither      -> <Say voice="Polly.Joanna">Please leave a message after the tone.</Say> (unchanged)
```

`Polly.Joanna-Neural` is the documented voice id (Twilio `<Say>` text-to-speech table, en-US,
Neural). I did not verify neural pricing; assume it is billed above standard Polly. WNW text:

> Thank you for calling Waynesville Neuro Wellness. We are unable to take your call right now.
> Please leave your name, number, and a brief message after the tone.

The org-level fallback (NP greeting audio, else the spoken default) stays for lines with neither.
`ring-complete`'s crash fallback (`Please leave a message after the tone.`) is unchanged.

---

## §10 Earlier line work

`grep -rniE "wnw|line_number_id|lineSlug|crm_comm_threads|line_e164" src supabase/migrations` returns
nothing. The only prior references to the second number are migrations 069 (seed) and 202 (the lost
inbound incident) and `HUB_Bulk_Campaigns_Design.md` §1. Nothing to build on; this doc is the plan.
Real routes are `inbound-call` and `inbound-sms`; the table is `conversations`.

---

## §11 Favicon placeholder (asked for in this pass)

`PASTE_NEURO_PROGENY_FAVICON_URL_HERE` does **not** appear in any file in this repo (src, public,
docs, migrations). It is a **stored value**: `org_settings.branding.favicon_url` for the Neuro
Progeny org, documented as sitting in production in
`npu-platform-v2/docs/NPU_Future_Features_Queue_v4_AddendumC.md` (lines 3721 to 3730), written there
by the Hub's `GET /api/settings/set-favicon?org_id&url` route.

The consumer is `src/components/dynamic-favicon.tsx`: it fetches `branding` and sets
`<link rel="icon" href={favicon_url || '/favicon.ico'}>`. With the placeholder the browser requests
`/PASTE_NEURO_PROGENY_FAVICON_URL_HERE` (404). `/favicon.ico` does not exist either: `/public`
holds only `images/np-logo.png` and `templates/`. There is no `<link>` tag to remove and nothing in
the tree that contains the literal. Two-part fix, both held for your go:

1. Data (SQL only, run in the editor):
   ```sql
   UPDATE public.org_settings os
   SET setting_value = os.setting_value || jsonb_build_object('favicon_url', '/images/np-logo.png')
   WHERE os.org_id = '00000000-0000-0000-0000-000000000001'
     AND os.setting_key = 'branding'
     AND os.setting_value->>'favicon_url' = 'PASTE_NEURO_PROGENY_FAVICON_URL_HERE';
   ```
   (`/images/np-logo.png` is the only NP asset in `/public`; a real 32×32 `favicon.png` dropped into
   `/public` would be better and can replace the path later.)
2. Code hardening in `dynamic-favicon.tsx`: treat a value that is neither `https://…` nor `/…` as
   unset, and change the fallback from the missing `/favicon.ico` to `/images/np-logo.png`.

Also seen in that platform note and **not** touched: NP `primary_color` is `#8B5CF6` (purple) and
Sensorium's favicon is stored under the NP org's media folder.

---

## §12 Decisions needed before "go"

| # | Decision | Recommendation |
|---|---|---|
| D1 | Is `+18289009821` in the NP Messaging Service sender pool, and is Sticky Sender on? | **Closed 2026-09-16: self-correcting, no console dependency.** `sendOrgSms` sends a pinned From together with the Messaging Service SID (the §4.1 form) and, if Twilio answers 21712 (number not in the pool), retries From-only. Either way the chosen line is the sender; explicit From on every Conversations reply (§5.4) is what keeps NP replies on `5050` regardless of Sticky Sender. |
| D2 | Line filter semantics: `line_e164` (most recent line, indexed) vs "any activity on that line" | Ship `line_e164`; revisit if a WNW thread that later texted NP causes confusion. |
| D3 | Add the inert `<Parameter name="line">` to the NP `<Client>` dial so NP calls also get a badge in the modal | Yes: no audible or routing change, but it is a TwiML diff on the NP line, so it is your call. |
| D4 | Fix `friendly_name` on the 069 seed row | Yes, one UPDATE (§7). `purpose='outreach'` stays: `pickNumber` would route cold-outreach SMS to `9821` only if the Messaging Service SID were ever cleared, and changing it now is a behavior change outside this work. |
| D5 | Screening / AMD on the cell leg (§9.4) | Not in v1. Turn on only if item 6 of §8 shows the carrier box winning. |

Pre-existing findings surfaced along the way, not fixed here: `inbound-call` lacks signature
validation; `call-status` attributes by "latest ringing row" instead of CallSid; `voice/answered`
writes `status='answered'`, which is not in the `call_logs.status` CHECK list as of `crm_001` (if
068's "already includes" note did not widen it, that update has been failing silently).

---

## §13 Files that will change (implementation phase)

| File | Change |
|---|---|
| `supabase/migrations/207_conversations_line_e164.sql` | §7, new |
| `src/lib/twilio-org.ts` | number type widened; `sendOrgSms` `from` override |
| `src/lib/inbound-voice.ts` | per-line resolution; `greetingText`; `lineE164` in context |
| `src/lib/crm-server.ts` | `getOrCreateConversation` / `bumpConversation` `lineE164` |
| `src/app/api/twilio/inbound-call/route.ts` | stamp line; forwarding `<Dial>` branch |
| `src/app/api/twilio/ring-complete/route.ts` | greeting text; mark completed by CallSid |
| `src/app/api/twilio/inbound-sms/route.ts` | stamp line |
| `src/app/api/twilio/recording-ready/route.ts`, `src/app/api/voice/answered/route.ts` | pass `to_number` on bump |
| `src/app/api/sms/send/route.ts`, `src/app/api/voice/token/route.ts` | `line_e164` in, validated |
| `src/app/api/comms/greeting/route.ts` | `line` scoping |
| `src/app/api/comms/lines/route.ts` | new, read-only numbers list |
| `src/lib/voice-receiver-context.tsx`, `src/components/crm/incoming-call-modal.tsx` | `customParameters` caller/line |
| `src/components/crm/twilio-comms.tsx` | `VoipCall` `lineE164` prop |
| `src/components/crm/comms-timeline.tsx`, `contact-comm-panel.tsx` | line on entries, badge |
| `src/app/(dashboard)/crm/conversations/page.tsx` | dropdown, filter, badge, effective line |
| `src/app/(dashboard)/crm/settings/page.tsx`, `voicemail-greeting.tsx` | per-number editor, clobber fix |
| `src/components/dynamic-favicon.tsx` | §11 hardening |
