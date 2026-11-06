# Data hygiene proposals (2026-11-05)

Proposals only. Nothing here has been changed. Each item needs Cameron's approval by its number.
Counts are live, unmerged, unarchived Neuro Progeny contacts unless stated.

## Pipelines

The three named Enrolled and the two named Sales Pipeline are in two orgs, so only Sensorium's two Enrolled are true duplicates.

| # | Pipeline | Org | Contacts | Proposal |
|---|---|---|---|---|
| P1 | Enrolled (6 stages, Application to Declined) | Sensorium | 0 own | Archive it as the duplicate. |
| P2 | Enrolled (14 stages, Inquiry to Sauna Cold Plunge Membership) | Sensorium | 0 own | Keep it. Rename it "Sensorium Client Journey" so it stops reading as a copy. |
| P3 | Enrolled (9 stages) | Neuro Progeny | 77 | Keep it. Not a duplicate. |
| P4 | Sales Pipeline (10 stages), default | Neuro Progeny | 9 | Keep it. Not a duplicate. |
| P5 | Sales Pipeline (7 stages), default | Sensorium | 0 own | Keep it as Sensorium's default. The shared key `default` is why it looks used. |
| P6 | 2 Neuro Progeny contacts pointing at Sensorium pipelines (Enrolled and Neuro Program) | Cross-org | 2 | Review each one, then move it to the right Neuro Progeny pipeline or to the Sensorium org. P1 should wait for this, because one of them points at P1. |
| P7 | Stage "Checkout started" sits last in Enrolled | Neuro Progeny | 3 | Move it first. It comes before purchase, and it feeds Checkout abandoned. |

## Tags

There are 227 distinct tags. `contact_tags`, the catalog system, has only 3 uses, so the `contacts.tags` array is the working system.

| # | Overlap | Contacts | Proposal |
|---|---|---|---|
| T1 | `mastermind` and `Mastermind` | 29 | Merge to `Mastermind`. |
| T2 | `podcast`, `Podcast` and `podcast_host` | 3 and 27 | Merge to `podcast_host`, after a look at the 3. |
| T3 | Interest pairs on the same people: "Leadership / burnout" and "Leadership resilience and nervous-system regulation" (21 each); "Nervous system regulation" and "Somatic and nervous system coaching" (17 each); "Sales performance" and "Sales performance under pressure" (11 each); "Business performance" and "Nervous-system-based business / executive performance" (14 and 13); "Corporate wellness" and "Corporate wellness and workplace resilience" (9 each); "ADHD / regulation" and "ADHD and overwhelm support through regulation" (5 each); "Breath / recovery" and "Breathwork" (5 each); "HRV / performance" and "HRV" (4 each); the Parenting and Vagus pairs (2 each) | As listed | Keep the shorter name of each pair as the interest tag: Leadership, Nervous system regulation, Sales performance, Business performance, Corporate wellness, ADHD, Breathwork, HRV, Parenting, Vagus. Check first that each pair is the same people, because I inferred that from the matching counts. |
| T4 | Fragments from comma-split imports: "and emotional load", "and stress adaptation", "and performance recovery" | 7, 5, 4 | Delete them. |
| T5 | `rank-N` tags (100 distinct) | 100 | Move to `outreach_rank`, which is empty on every contact, then delete the tags. |
| T6 | URLs used as tags (26 distinct) | About 26 | Move to `website_url`, `linkedin_url` or `instagram_handle`, then delete the tags. |
| T7 | US state codes as tags (18 distinct) | About 30 | Move to `address_state` where it's blank, then delete the tags. |
| T8 | `Enrolled`, `Mastermind` and `xRegulation` in both `tags` and `auto_tags` | 26 of 28, 25 of 28, 20 of 23 | Remove the manual copy where the auto tag exists, and review the 2, 3 and 3 that are manual only. Pipeline logic stays on the pipeline column. |
| T9 | `Instagram` and `LinkedIn` as tags | 63 and 37 | Move to source (S3), then delete the tags. |
| T10 | `quarantine:test-record` | 4 | Keep it. Metrics and smart lists exclude these contacts by it. |

## Contacts with blank source

91 contacts have a blank source, and `acquisition_source` is blank on all of them. Only the values below are proposed, because nothing records the true origin.

| # | Pipeline | Contacts | Proposed source |
|---|---|---|---|
| S1a | Enrolled | 29 | `unknown_enrolled` (real clients, origin not recorded) |
| S1b | Collaborations | 17 | `partner_outreach` |
| S1c | June 2026 NP Outreach | 11 | `outreach_2026_06` |
| S1d | Waynesville Neuro Wellness | 8 | `wnw_local` |
| S1e | Sales Pipeline | 9 | `unknown_sales` |
| S1f | No pipeline | 9 | `unknown` |
| S1g | Podcasts | 2 | `podcast` |
| S1h | One each: Middle Management and Sales, Xregulation Leaders, Subscribed, Business executive and performance coaches, Cameron referral follow-up, B2B Business | 6 | `referral` for Cameron referral follow-up, `unknown` for the rest |

Non-blank sources that hold the wrong thing:

| # | Problem | Contacts | Proposal |
|---|---|---|---|
| S2 | City or state names as source (Chicago, Denver, Dallas and others) | About 30 | Move to `address_city` or `address_state` where blank, and set source to `unknown`. |
| S3 | URLs as source | 109 (60 Instagram, 45 LinkedIn, 4 other) | Set source to `instagram_research` or `linkedin_research`, and keep the URL in the profile fields. |
| S4 | Case and naming variants: `Import`, `Other`, `Website`, `Podcast`, `manual-chat`, `manual_ecr`, `admin` | About 17 | Map to one lowercase vocabulary, matching the channels in `docs/metrics/definitions.md`. |

## Found along the way, not asked for
- **D1. Merged duplicates carrying do-not-contact:** all 3 current clients with a usable phone have a merged-in duplicate marked do-not-contact, while their own record isn't. This blocks them from texting, and 96 Neuro Progeny contacts have the flag in total. Review whether those flags were real opt-outs.
- **D2. Phones:** 24 of 27 current clients have no usable phone on the contact. 4 of them have a phone on their platform profile that could be copied over.
- **D3. Completed-stage contacts with no purchase record:** 25 contacts are in the two Completed stages, and none links to an enrollment or entitlement. Clarity graduates without Capacity stays at 0 until they are linked.
- **D4. Stable-id positions lag the board:** 23 contacts had no `contact_pipeline_positions` row for their board pipeline when read earlier today. Smart lists read the board's values, so they aren't affected.
