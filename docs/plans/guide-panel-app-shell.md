# Plan: the Hub Guide panel in the shared app shell (ruling 26)

**Status: PLAN, awaiting Cameron's approval. Nothing below is built.**
Branch: `feat/guide-panel-shell` (off main `2b5d458`).
Ruling: 26 in `docs/plans/hub-agent-build-rulings.md` section 12.
Queue ref: Addendum C §MN, in npu-platform-v2. The line for it is not yet added there; see that file's section 12.

## 1. The problem, measured

- The Guide and Builder panel (`src/components/marketing/agent/agent-panel.tsx`) is mounted only
  inside `src/components/marketing/funnels-panel.tsx`, so it exists only on Campaigns > Funnels.
- The click-through on 2026-10-02 showed the consequence. "Take me there" moved the person from
  `/campaigns` to `/crm/settings`. The panel unmounted and its answer, steps and session were lost,
  so the walkthrough could not continue.
- `src/app/(dashboard)/layout.tsx` already wraps every screen in providers that survive navigation
  (workspace, permissions, voice receiver, sidebar, toast), and already mounts two global
  surfaces outside the page tree: `IncomingCallBanner` and the older `HelpBot`.

## 2. What will be built

1. **`AgentShellProvider`** (new, `src/components/marketing/agent/agent-shell.tsx`), mounted in the
   dashboard layout inside `ToastProvider`, beside `HelpBot`. It holds the panel state in one reducer:
   - open or closed, and the mode (`guide` or `builder`);
   - the Guide session id, the last answer (text, cited ids and steps) and the step the person has
     reached;
   - the Builder's campaign id (set by Revise).

   It renders the one `AgentPanel`, so there is exactly one instance on every screen.
2. **State survives navigation** because the layout does not unmount. **It also survives a reload of
   the same tab**, through `sessionStorage` keyed by user and org. Two limits on what is stored:
   - **the question as typed is never stored.** The route will return the scrubbed question (emails
     and phones removed, as already logged) and only that is kept;
   - **the state is cleared** on org switch, on sign-out, and by Start over.
3. **The stepper continues across pages.**
   - Each step gets a Done control, and the panel shows "Step 2 of 4".
   - After Take me there, the panel stays open on the destination with the next step current, and
     Show me works there because the control now exists in the DOM.
   - Nothing clicks, types or submits for the person: ruling 18 is unchanged, and `show-me.ts` is
     reused as is.
4. **Who sees the launcher comes from the server.**
   - A new `GET /api/marketing/agent?org_id=` (`withStaff`) returns `{ guide, builder }` booleans,
     computed with the same checks the POST actions use: flag, role setting and superadmin.
   - The shell calls it on load and on org switch. Hiding the launcher remains a convenience; every
     POST still checks again.
5. **Campaigns > Funnels no longer mounts its own panel.**
   - Its Hub Guide, Campaign Builder and Revise buttons call the shell (`open('guide')`,
     `open('builder', campaignId)`).
   - After Build, the shell navigates to `/campaigns?tab=funnels&funnel=<id>`, which is already
     supported, and the Funnels panel reloads on a `builtAt` value from the shell.
6. **Help content.**
   - `hub-guide.md` says where the launcher is and that the panel follows you between pages.
   - The launcher and the Done control get help ids, and the registry and corpus are regenerated.

**No migration. No flag changes.** `help_bot_enabled` stays off until you switch it on after this
ships.

## 3. Decisions that are yours (recommendation first)

1. **The older HelpBot.** Once the Guide is in the shell there would be two help surfaces on every
   screen.
   - **Recommend:** for a person the server allows to use the Guide, the shell hides `HelpBot`. For
     everyone else `HelpBot` stays exactly as it is.
   - Retiring it, and `/api/ai/help-bot`, becomes a separate item.
   - The alternative is both side by side, which is confusing and is not recommended.
2. **Where the launcher sits.**
   - **Recommend:** the bottom-right corner HelpBot uses today, for people allowed the Guide, so there
     is one help button wherever someone looks for it.
   - The alternative is an item in the sidebar footer.
3. **Survive a reload, or only navigation?**
   - **Recommend:** `sessionStorage`, holding only the scrubbed text. It is per tab and cleared when
     the tab closes.
   - The alternative is memory only, which matches the ruling's minimum but loses the walkthrough on
     a refresh.
4. **The Builder in the shell.** The Builder tab would appear on every screen for a superadmin with
   `agent_enabled`.
   - **Recommend:** yes. It is the same panel and the same server checks, and the only way to start it
     today is to be on Campaigns.

## 4. Tests (gate 1: each with a planted defect reddening exactly its declared set)

New `scripts/agent/shell-panel-tamper.cjs`:

| Case | Proves |
|---|---|
| S_MOUNTED | the dashboard layout imports and renders `AgentShellProvider` (comments stripped, like `nocaller`) |
| S_SINGLE | no component other than the shell renders `AgentPanel` (catches a second mount) |
| S_NAVIGATE | the reducer keeps session, answer and step on a route change, and clears all of it on org switch and on Start over |
| S_STORAGE | what is written to storage is keyed by user and org, and never holds the typed question (a planted email in the question must not appear) |
| S_CAPS | the GET returns `guide: false` with the flag off or the role not allowed, and `builder: false` for a non-superadmin, through the real route |
| S_HELPBOT | (if decision 1 as recommended) `HelpBot` is not rendered for a person allowed the Guide, and is unchanged otherwise |
| C_* | controls: the same checks pass with the code correct, and the GET says true when allowed |

Existing harnesses stay green. `guide-tamper` G_CONTEXT is extended to the scrubbed question the
route now returns.

## 5. Click-through (needs your approval again: production writes, like 2026-10-02)

Run on localhost with the stub model, as you, on Neuro Progeny, with both flags on for the run:

1. Ask the limits question on Campaigns, press Take me there, and confirm the panel is open on CRM
   Settings with step 1 current.
2. Show me outlines the switch there. Done moves on to step 2.
3. Reload the tab: the same answer and step come back.
4. Switch org: the panel is cleared.

Then the cleanup, with asserted counts and a read-back against the captured baseline, as before.

## 6. Stages, each stopping for your review

1. The shell provider, the reducer, the GET, and Funnels moved onto the shell, with
   `shell-panel-tamper`, `verify` and `next build`.
2. Storage and the HelpBot decision, and help content.
3. The click-through, the cleanup, then one merge, a deploy confirmed by SHA, and the flags confirmed
   off.

## 7. Risks

- **Two help surfaces** for anyone the Guide does not allow, until HelpBot is retired. That is by
  design under decision 1.
- **`sessionStorage` holds answer text.** It contains no contact data, because the Guide never sees
  contact data (ruling 19), but it is readable by scripts on the same origin, as everything in the
  app already is.
- **The layout is shared by every screen.** A render error in the shell would affect them all, so
  the provider renders nothing until the GET answers, and catches its own errors.
