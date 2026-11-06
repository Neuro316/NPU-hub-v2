# Data hygiene: rulings and review (2026-11-05)

The data changes are in `supabase/data-fixes/2026-11-05_hub_hygiene.sql`, and the merge-flag fix is `supabase/migrations/hub_226_merge_flag_is_not_an_opt_out.sql`.
Neither is applied. Apply the data fix first, then hub_226, each on Cameron's go.

## Cameron's rulings
- **In the data fix:** D2 (Ted Adams and Sarah Leslie only), D3 (2 of 25), P6, T1, T2, T3 (all 10 pairs), T4, T5, T6, T7, T9, S1a to S1h, S2 (as `prospect_unknown`), S3, S4, the 11 test accounts, and Clarity graduates by stage.
- **In hub_226:** D1, by the rule that a merged duplicate's flag counts only if its merge snapshot shows it was set before the merge. Also the cold outreach correction, the added backfill exclusions and the test-record block (see Amendments of 2026-11-06).
- **T7, narrowed:** only the 50 US state codes and DC move to `address_state`. Any other two-letter tag stays a tag.
- **In code:** the merge route no longer sets the flag, and `leadChannel` keeps the new unknown values in `unknown`.
- **No change needed:** P3 to P5, T10.
- **Ruled out:** P1, P2, P7, T8, and the neuro@ and sgranau+test4@ phones.

## D1: do-not-contact flags in the 27 current clients' families
Six flags, on 4 clients. 23 clients have none. Every flag sits on a merged duplicate, never on the client's own record.
No flag has a STOP record, unsubscribe, suppression or do-not-contact list row behind it.

| Client | Record holding the flag | Set | How | Flag before merge | Related consent record |
|---|---|---|---|---:|---|
| Brenda Walls | `6222b972` (no email or phone) | 2026-07-23 | Merge | No | None |
| Cameron Allen | `5921c286` cameron.s.allen+buyertest1@gmail.com | 2026-07-23 | Merge | No | SMS service granted 2026-07-14 (checkout import) |
| Cameron Allen | `68099477` cameron.s.allen@gmail.com, 8287347558 | 2026-07-22 | Merge, migration 072 | No | Same |
| Hazel Thornton | `8ad1c36b` sgranau@gmail.com | 2026-07-23 | Merge | No | None |
| Melissa Allen | `9af172f5` melissa.k.allen10@gmail.com | 2026-07-22 | Merge | No | SMS service and marketing revoked 2026-07-15 (checkout import) |
| Melissa Allen | `4c4819cc` melissa.k.allen10@gmail.com | 2026-07-22 and 23 | Merge | No | Same |

Melissa's revoke is a separate, real record on her own contact, and it keeps blocking texts whatever is decided here.

### Why the flags exist
`src/app/api/contacts/merge/route.ts:229` sets `do_not_contact = true` on every merged duplicate, and migrations 072, 076 and 079 did the same.
It was meant to stop outreach to a hidden record. All 36 merged duplicates have the flag. The log's before-merge snapshots show true on 3:
- Erica Thiessen's came from an earlier merge of the same record, later corrected.
- The other 2 are a duplicates-queue merge and a merge test, on other contacts.

### The defect this exposes in hub_225
`hub_email_marketing_allowed`, `hub_texting_allowed` and the backfill treat a flag on any merged duplicate as a real opt-out. That was my mistake.
- **Blocked:** 26 live contacts have a merged duplicate with the flag.
- **Left out of the email backfill:** 21 of them have a valid email and got no consent row. None has a research source.
  They are Amy Gordon, Bob Curtis, Brenden Allen, Bryant Smith, Cameron Allen, Caroline Yongue, Ella Brown, Erica Thiessen, Gabriel Robinson, Harper MacKenzie, John Fahl, Matt Kolousek, Brenda Walls, Melissa Allen, Millard Powell, Mary Lynn Manley, Ian Gough, Rachel Kimmel, Hazel Thornton, Skot Waldron and Wes Lehman.
- **Fix:** hub_226 restores 18 of the 21 by backfill. Erica Thiessen stays blocked (Cameron's ruling, 2026-11-06) because her snapshot shows the flag set, Melissa Allen's address already has a row through her other contact, and Hazel Thornton becomes a test record.

## Amendments of 2026-11-06
All counts below were recounted against live data on 2026-11-06. Every data-fix item came back at the number already in the file. Nothing is applied.

| Item | Result |
|---|---|
| Cold outreach revokes | 23 contacts, guarded at 20 to 23 |
| Backfill | Still 18. The new exclusions remove none of them, guarded at 15 to 20 |
| Test records | 16 live tagged contacts after the data fix, 0 on the allowlist |
| T7 | Still 35. All are state codes, so no two-letter tags stay behind |
| Email marketing allowed | 97 today - 23 cold - 11 test + 18 restored = 81 |

### Cold outreach corrected in hub_226
hub_225 backfilled these 23 under `existing_relationship`, which Cameron ruled out for cold outreach. Each gets one `consent_events` row: email, marketing, revoked, basis `admin`, source `existing_relationship_2026_11_withdrawn`, with evidence saying it corrects the backfill. Anyone with an express opt-in is skipped, in the ledger or on the contact's consent fields. None of the 23 has one, and none has a send or an enrollment.

| Group | Count | Contacts |
|---|---:|---|
| June 2026 NP Outreach, blank source | 11 | Angie Chaplin, Anna Gudmunson, Catherine McCarthy, Danielle Griff, Darrell Barr, Divine Celiane, Gary Jacobs, Jenna Lee Anderson, Robert Rhoton, Tammy Waldron, Tony Alexander |
| Coaches and Therapist, source was a city | 12 | Amy Porterfield, Angela Martinucci, Ashlyn Burnett, Diane Grimard Wilson, Ed Mylett, Grant Cardone, Jay Abraham, Joel Jamieson, John Maxwell, Leah Lagos, Sean Brawley, Tara Garrison |

Not covered by the ruling, so their grants stay:
- **Brent Beam:** in Coaches and Therapist, with source `Other` rather than a city.
- **The 7 Collaborations contacts (`partner_outreach`):** Adam Grimm, Amanda Gautreaux, Brian Ellis, Christina Font, David Wiacek, Sarah Leslie, Dr. Shami Varthan.

All 11 June contacts are at a Discovery Call stage (9 completed, 2 scheduled). The Hub will describe them as having withdrawn, because `marketing_revoked` reads "This person withdrew their agreement".

### Backfill exclusions
hub_226's backfill also excludes `prospect_unknown`, `outreach_2026_06` and any `*_research` source. The 18 are 9 `xregulation`, 7 `unknown_enrolled`, 1 `unknown_sales` and 1 `unknown`.

### Test records
`hub_email_marketing_allowed` and `hub_texting_allowed` return false for a contact tagged `quarantine:test-record` unless its email or phone is on `campaign_test_contacts`. `gate_check` denies the same contacts with reason `test_record`, on every channel and kind, after the engine and WNW sender checks. All 11 test accounts tagged by the data fix hold a hub_225 grant and read as allowed today. This turns them off.

A tagged contact's phone matches the allowlist on its last 10 digits, the way `gate_check` compares them. To run a live test through one of these accounts, add its address to the allowlist first.

## T3: the 10 proposed pairs
Each pair is nearly the same people. Cameron ruled to merge all 10.

| Keep | Tags merged | First tag | Second tag | On both | Sample |
|---|---|---:|---:|---:|---|
| Leadership | Leadership / burnout + Leadership resilience and nervous-system regulation | 21 | 21 | 21 | Carole Osterweil, Oxana Lopyreva, Dr. Chris Lee, Shawnta Speaks |
| Nervous system regulation | Nervous system regulation + Somatic and nervous system coaching | 17 | 17 | 17 | Sophie Roe, Jennie Tian, Mitch Webb, Steph Veltman |
| Sales performance | Sales performance + Sales performance under pressure | 11 | 11 | 11 | Mor Assouline, Malisa Nguyen, Alex Vigilante, Josh Braun |
| Business performance | Business performance + Nervous-system-based business / executive performance | 14 | 13 | 13 | Brandi Mackenzie, Masha, Drew, Michelle Grosser |
| Corporate wellness | Corporate wellness + Corporate wellness and workplace resilience | 9 | 9 | 9 | Jennifer Rivlin, Margo Gladys, Lauren Dike, Ashley Mikell |
| ADHD | ADHD / regulation + ADHD and overwhelm support through regulation | 5 | 5 | 5 | Katherine Sanders, Sam Bramwell, Risa Ramirez Wright, Bianca Faricy |
| Breathwork | Breath / recovery + Breathwork | 5 | 5 | 5 | Miles Lukas, Thomas Hague, Tim van der Vliet, Jesse Coomer |
| HRV | HRV / performance + HRV | 4 | 4 | 4 | Justin Ternes, Xico Teixeira, Jessica Corbin, Dr. Jay Wiles |
| Parenting | Parenting / regulation + Parenting and co-regulation support | 2 | 2 | 2 | Vivian Meraki, Alyssa |
| Vagus | Vagus / regulation + Vagus nerve and regulation education | 2 | 2 | 2 | Navaz Habib, Carrie Rigoni |

## P6: the 2 contacts on Sensorium pipelines
| Contact | What's there | Proposal |
|---|---|---|
| Hazel Thornton `e734ad21` | Email sgranau@gmail.com, phone +14803923832, source manual_ecr. Stage "Enrolled" on Sensorium's Enrolled. The platform profile on that email is named "test test" with 2 enrollments, and she counts as a current client through it. | Likely Shane's test account: tag `quarantine:test-record` and clear the pipeline. If she is a real person, move her to Neuro Progeny Enrolled, "Paid/ payment plan". |
| Test Test `6482fcaa` | No email or phone, already tagged as a test record and do-not-contact. Stage "Application" on Sensorium's Neuro Program. | Clear the pipeline. |

## T2: the 3 contacts
All three are in the Podcasts pipeline.

| Contact | Email | Tag | Stage |
|---|---|---|---|
| Christopher Times | christophertimes2@gmail.com | podcast | Recorded |
| Rachel Russell | rachelrussell33@gmail.com | podcast | Post Podcast SM |
| Alexandria Viera | vieraalexandria@gmail.com | Podcast | Downloaded Podcast/Google Drive |

## D2: the 4 phones
| Contact | Phone | Note |
|---|---|---|
| Ted Adams | +18283616183 | |
| Sarah Leslie | +15619018965 | |
| Neuro Progeny (neuro@neuroprogeny.com) | +18287347558 | House account, and this is Cameron's number |
| Shane Granau (sgranau+test4@gmail.com) | +14803992332 | Looks like a test account |

Cameron ruled to copy only Ted Adams and Sarah Leslie. A fifth client, Brenda Walls, has 3178004365, which isn't in E.164. It wasn't in the ruling, so it's unchanged.

## D3: the 25 Completed-stage contacts
**None of the 25 can be linked to an enrollment or entitlement.** The platform has no such record for them under their own email, so Clarity graduates stays at 0 after this.

| Result | Contacts |
|---|---|
| **Exact email match to a profile, linked in the file** (profile has no enrollments) | Brian Lawrence, Jeremy Dalidowitz (email on a merged duplicate) |
| **Name match only, different email: not linked** | James Skelton (jamesskelton01@gmail.com, 4 enrollments, 1 payment; also james@somaathene.com), Shane Granau (shane@neuroprogeny.com and sgranau+test4@gmail.com), Doug Blessington (doug@neuroprogeny.com), Ella Brown (ella@neuroprogeny.com, ella@sensoriumneuro.com) |
| **No profile, accounting record only** | Rachel Kimmel, Tyler Bender |
| **No platform or accounting match** | Adam Bridges, Anja Linblad, Barrett Swartz, Bob Curtis, Brenden Allen, Charles Tyler Bender, Cindy (no last name), David R. Allen, Donald Cleary, Erica Thiessen, Gabriel Reich, Josh Winnecour, Laura Lawrence, Millard Powell, Sarah Seed, Tommy Cook, Wes Lehman |

- **Likely cause:** 17 of the 25 show `neuroreport_program = xRegulation`, so they probably finished the program before the platform held enrollments.
- **James Skelton and Shane Granau** also appear in the 27 current clients under other contacts, so those look like duplicate contacts to merge. Only James has enrollments that would matter.
- **Ruling:** the Clarity graduates list is redefined by stage, without the Clarity purchase rule, so these 25 alumni show.

## How enrollments are meant to end
Nothing ends a cohort enrollment today.

| Path | Field | Set by | Live data |
|---|---|---|---|
| Solo or rolling programs | `programs.access_days` sets `entitlements.expires_at` | Platform, at grant (pf_266) | 6 of 67 entitlements have an expiry; 1 has passed |
| Promo codes | `enrollments.access_ends_at` | Platform, at redemption (pf_279) | 3 of 74, all Fresh Air, none passed |
| Dated cohorts, including Capacity Protocol ("5 Weeks") | `cohorts.end_date` | Manual, on the platform's cohort and paywall pages | Blank on every cohort read |
| Completion | `enrollments.completed_at`, `status` | No platform write found for `completed` | 0 of 74 set |

To populate the lists:
1. **Set `cohorts.end_date`** on the platform's existing admin pages. This is data entry, not a platform change.
2. **Change the Hub's current-client function** to treat an enrollment as ended once its cohort's end date passes, and to stop counting that cohort's undated entitlement. That's a Hub migration and needs a go. Past clients would then populate.
3. **Decide what "graduate" means.** Cohort ended, with no refund or drop, can be done in the Hub. A real completion record means the platform must write `completed_at`, **which is a platform change. I haven't made it.**

## Also found
- **Test accounts:** the data fix tags test coach 2, xreg test, Multi org test, Slack Test, Ctest, TESTpay2, Test Free promo, new test, Shane test, Coaching Client Test, Neuro Progeny and Hazel Thornton. Shane Granau (sgranau+test4@) is not in the ruling and stays a current client.
- **S1 and Leads:** with the `leadChannel` change, the 28 `partner_outreach` and `outreach_2026_06` contacts leave Leads history as prospecting. The rest stay in `unknown`, except the 2 `podcast` contacts, which move to `podcast_pr`.
