# FSOS automation audit — report

Branch `fix/automation-e2e` · 2026-10-02 · brief: [`automation-audit-brief.md`](automation-audit-brief.md) ·
inventory, defect register and owner decisions: [`automation-inventory.md`](automation-inventory.md) (§10 holds the
checkpoint decisions this work implements) · plan: [`../superpowers/plans/2026-10-02-automation-e2e-repair.md`](../superpowers/plans/2026-10-02-automation-e2e-repair.md).

No client PII appears in this report. Production rows are referenced by the first 8 characters of their id only.

## 1. Outcome

Nothing reached a client. No live provider send was made: both canary contacts arrived as blank placeholders, so every
check that needs a real phone or inbox is **NOT VERIFIED** (§8). Production was only read, with aggregate SELECTs inside
`begin read only` transactions. No migration, data fix or switch was applied anywhere. Nothing was merged or deployed.

Production today sends nothing (0 outbound messages in 30 days). That is mostly as configured: every campaign is paused
or draft, and the consent stores the engines read are empty. The repairs below are therefore mostly about what happens
**when an owner turns something on**. That is where the defects were, and where they would have fired.

## 2. What changed (one commit per repair, each with its regression test)

| Area | Repair | Audit IDs | Commit |
|---|---|---|---|
| **Send-when-shouldn't** | Consent/DNC/revoke readers fail closed on a returned Supabase `{error}` | A-02, B-01 | `8f48656` |
| | Frequency caps count every accepted send, not only rows still `sent` | A-03, E-01, H-02 | `e9307f3` |
| | A conversational "yes…"/"help…" is a reply; only a **bare** START/HELP is a keyword | B-02, B-03 | `76aeba1`, `f037ef6` |
| | START only lifts a **keyword** opt-out (inbound STOP / carrier 21610), never deletes, never creates consent (mig 138) | B-02, decision 4 | `76aeba1` |
| | A recorded revoke beats a durable consent basis | G-08, decision 5 | `1c5c6ac`, `34de5ca` |
| | Stop/reply conditions apply to every member sharing the address | B-04 | `a7d99a6` |
| | Recipient-local quiet hours by code default; address → area code → every continental zone; floor on all campaign SMS; Sunday-noon marketing hold | A-04, decisions 1–2 | `0dc872e`, `3a8917b` |
| **Term conversion / campaigns** | Life Conversion and Cross-Sell Life are MARKETING at the gate (code + mig 139) | D-01, E-07, decisions 6, 10 | `bbc88f0` |
| | Workforce stands down for engine-owned audiences; referral first touch is one-time and durable; no automated contact for a referral older than 14 days | D-03, F-01–F-03, H-01, I-01, decision 7 | `8b80083` |
| | Every appointment (booked or FSA-scheduled) stops prospecting for that household | D-02, I-02, G-01, G-02 | `ae17d0c` |
| | Life Conversion stops when the policy is no longer in force | D-09 | `73a4b30` |
| | Enrollment sweep no longer starves or floods advisor tasks | D-04 | `6491fe4` |
| | An unapproved template holds the touch (72 h), it is not burned | D-06 | `a2e0ef1` |
| **Callbacks / status truth** | Delivery status is monotonic; conditional writes; the send path cannot regress a faster callback | A-11, B-07–B-09 | `399f1a9` |
| | Provider rejections classified; a synchronous 21610 is applied as a carrier opt-out; rejected ≠ blocked | A-07, B-05, B-06 | `bc80100` |
| | Resend `Idempotency-Key` per message | A-10 | `4808db3` |
| | A failed opt-out write is never reported as success; STOP applied before threading; webhooks answer 503 | B-13, B-14 | `128241a` |
| | Off/canary/on automation switch (mig 140); carrier opt-out can close cadences **behind `callback_engine_state`, off** | B-10, D-12 | `1279150` |
| **Remaining workflows** | `campaign-dispatch` and `district-nurture-tick` → 17:00 UTC | A-05, A-06, C-02, J-02, J-03, decision 8 | `188f280` |
| | Quiet hours **holds** marketing (72 h, reason recorded on expiry) in all engines | decision 3 | `a8a04a3` |
| | Reminder SMS move to the nearest allowed time before the appointment, else skip | decision 3 | `7e4a13a` |
| | Every cron route requires `Bearer CRON_SECRET` | A-01, C-07, J-01, decision 9 | `4b41469` |
| | A failed cron run is recorded (`errored`) and still retried | J-07, H-15 | `08fe45c` |
| | Campaign dispatch honours `marketing_automation` + global switch; a drip on an inactive sequence holds instead of completing | C-05, C-01 | `aa2e438` |
| | Win-Back no longer pauses on its own thread | E-06 | `a5cc674` |
| | District nurture pause keyed on the agent's own thread | B-11, H-06, H-07 | `8f2c649` |
| | Public referral intake inserts (`owner_scope` null); no DB text to anonymous callers | H-03 | `8d5543d` |
| | Workshop kill switch fails closed on a returned read error | G-07 | `14c45ac` |
| | Social publisher refuses a revoked channel; disconnect cancels pending posts | H-10 | `c2b4647` |
| | Retry sweeps reconcile a sent orphan; release a never-dispatched one **behind `engine_retry_redispatch`, off** (mig 141) | D-07, E-10, H-11, J-06 | `bf9afcb` |
| **#265 class / UI truth** | Automation registry + wiring guard (`tests/automation-wiring.test.mjs`), proven red before the UI fix | #265, I-04, E-05 | `d41488f` |
| | Surfaces claim only what the runtime does; status from execution evidence | E-05, E-16–E-18, F-15, I-04–I-24 | `da8e85f` |
| **Final review fixes** | Every opt-out re-arms a START-lifted DNC row; a STOP never relabels another opt-out; START restores only documented prior consent; broadcast hold bounded | review findings 1, 2, 4 | `37d495d` |
| Test infrastructure | e2e aligned to decisions 1/2/4/7; PostgREST shim `.or()` range terms; rollback proof for migs 138–141 | — | `e50bd8b`, `3deff25`, `f80ac5c` |

### Closing the #265 failure class

`src/lib/ops/automation-registry.ts` lists every automation FSOS presents: 21 `[job]` crons, 3 static cron routes,
3 provider webhooks and 5 display-only catalogues. `tests/automation-wiring.test.mjs` fails CI when any of these holds:

- a `vercel.json` cron resolves to nothing;
- a `JOBS` key is never scheduled;
- a cron has no registry entry, or dispatches to a different handler than declared;
- the declared cadence disagrees with `vercel.json`;
- a reference-only catalogue renders without `REFERENCE_COPY_LABEL` ("Reference copy — not dispatched").

The guard was committed **pinned red** (`d41488f`): the Win-Back event-driven card read "These fire on events", and the
workflows builder offered Enable with no executor. The pin was removed in the commit that fixed the UI (`da8e85f`).

## 3. Status of every automation after this branch

Statuses refer to the code on this branch. **Enablement is exactly as found**: nothing was turned on.

| Automation | Before | After (code) | Production enablement (unchanged) |
|---|---|---|---|
| Send chokepoint (`messaging.ts`) | PARTIAL | WIRED — fail-closed reads, classified errors, idempotent email | live |
| Twilio status callback | PARTIAL | WIRED — monotonic, 21610 applied; engine stop behind switch | live; `callback_engine_state` **off** |
| Inbound SMS/email (STOP/START/HELP/replies) | PARTIAL | WIRED | live |
| Resend events + suppression | PARTIAL | WIRED — 503 on lost suppression | live |
| Booking confirmations/reminders | PARTIAL | WIRED — reminders respect the floor | live; SMS legs held by A2P (ASSUMPTION, §6) |
| Life Conversion | BROKEN | WIRED (marketing, holds, stops on booking/inactive policy) | **paused** |
| Cross-Sell Life | BROKEN (invalid purpose) | WIRED | **paused** |
| Pipeline Win-Back | BROKEN (self-pause) | WIRED | **paused** |
| District nurture | BROKEN (window, pause) | WIRED | **draft** |
| Campaign retry sweeps | DISPLAY-ONLY recovery | Reconcile WIRED; re-dispatch behind switch | `engine_retry_redispatch` **off** |
| Broadcast campaigns (`campaign-dispatch`) | BROKEN (12:00 UTC) | WIRED at 17:00 UTC; kill-switch aware | 0 active campaigns; `marketing_automation` agent must be enabled first |
| Native drips | DISCONNECTED | Holds on inactive sequence (no activation added — hard stop) | 0 sequences |
| AI workforce | BROKEN (daily re-message) | WIRED — referral_followup only; others stand down | agents enabled as found |
| Workshop engine | fails open on read error | WIRED | runs only once `CRON_SECRET` is set |
| Social publishing | PARTIAL | WIRED | 0 entries |
| Public referral intake | BROKEN (insert failed) | WIRED | live |
| Detection jobs (renewal, conversion, x-date, cross-sell scan, dormancy, SLA, commission, data quality, backup) | WIRED | WIRED; failures now recorded | live |
| Workflows builder | DISPLAY-ONLY | REFERENCE (cannot be enabled) | 0 enabled |
| Scheduled reports, outbound webhooks, data exports | DISPLAY-ONLY | Truthful copy ("not sent / not delivered / not generated yet") | — |
| Playbook follow-ups (Win-Back, Cross-Sell, Life) | DISPLAY-ONLY | REFERENCE | — |

## 4. Deploy order and prerequisites (owner)

1. **Set `CRON_SECRET` in Vercel before merging**, or every cron answers 401 (decision 9; status UNANSWERED).
2. Apply migrations **138, 139, 140, 141** before or with the code. Each is additive or a config row and carries a
   `-- ROLLBACK:` block, proven on real Postgres by `tests/automation-migrations-rollback.test.mjs`. Roll back 141
   before 140. The code is safe without 138 (no row ever reads as lifted) and without 140/141 (a missing switch row is
   off).
3. `marketing_automation` is seeded **disabled** (mig 010): broadcasts and drips halt until the owner enables it on
   `/app/ai` (C-05 now honours it).
4. Leave both switches **off** until the canary checks pass; then `canary`, then `on`.

## 5. Owner decisions recorded but left unanswered, and policy questions not acted on

UNANSWERED placeholders from the checkpoint reply:

- the production value of `QUIET_HOURS_RECIPIENT_LOCAL` (moot: no longer read);
- `CRON_SECRET` status;
- `SMS_A2P_APPROVED`;
- the unmatched Resend sender;
- the canary contacts.

The optional FNA switch was not started.

Gate-policy questions from inventory §6 that the decisions did not cover. The code was left as is:

- **Q7** contact-consent purpose scope;
- **Q8** promoting `comm_contact_consents` to members. This is why the workforce and campaigns reach nobody;
- **Q9** consent backfill basis;
- **Q10** household-level securities flag blocks appointment notices;
- **Q11** email unsubscribe vs transactional;
- **Q12** HELP/STOP ownership with Twilio Advanced Opt-Out;
- **Q13** flagging permanent-failure numbers (21211/21614). They are classified `permanent` but not flagged;
- **Q14** wrong number / deceased;
- **Q15** natural-language stop → consent revoke;
- **Q16** AI approved-template standard;
- **Q17** mandatory first-message sender ID;
- **Q20** `households.do_not_contact` as a gate input;
- **Q21** referral consent provenance;
- **Q22** fixed −6 business-hours offset. This is one hour off during CDT; the e2e now documents both clocks;
- **Q23** template approval by migration;
- **Q24** bulk campaigns with non-marketing purposes;
- **Q25** district nurture consent basis;
- **Q26** frequency resolver fails open on a count error;
- **D-05** A2P-hold scope (plan task 13).

Counsel question (decision 6): can a term-conversion deadline notice with no product pitch be servicing?

## 6. Facts the owner asked for

**What would send SMS if `SMS_A2P_APPROVED` were on** (traced in code; production state as read):

| Path | Would it send today? |
|---|---|
| Booking confirmations / reschedules / cancellations / reminders (`booking/notify.ts`) | **Yes**, to bookers with an SMS opt-in, now inside the floor |
| Inbound AI auto-reply (`comms/inbound.ts`) | Only on 3 armed threads, after the AI-authority hold and the gate |
| Console send / test send / conversation start (`/api/comms/send`, `/test`, `/conversations/*`) | Operator-initiated only |
| Workforce `referral_followup` (SMS, target 15) | No: none of the 5 open referrals has a household, and all are over 14 days |
| Life / Cross-Sell / Win-Back / District ticks | No: paused or draft |
| Broadcasts, drips, legacy `/api/campaigns/run` | No: 0 active campaigns, 0 sequences; `marketing_automation` disabled |
| Workshop engine (`workshops/comms-engine.ts`), workshop register ack | Only once `CRON_SECRET` is set, and only with SMS consent |
| Forms SMS (`lib/forms.ts`) | Through the gate, on form submission with consent |

**The five stale referrals.** All are 67–73 days old, past SLA, with no linked household and never first-touched. Per
the decision, they get no automated contact; they are listed for FSA follow-up: `a2ba83ce` (73 d), `9e46d9c0` (68 d),
`54dbe471` (67 d), `979a7bbe` (67 d), `99d86931` (67 d). A sixth referral (`26f8f8de`, 74 d, `working`) was already
touched.

**Six past-dated appointments still `scheduled`.** Report only; the owner updates them:

| Appointment | Start date | Days past |
|---|---|---|
| `6f9a0d80` | 2026-08-04 | 59 |
| `dcfbbf8f` | 2026-08-04 | 59 |
| `5b785b1f` | 2026-08-09 | 54 |
| `81a6a759` | 2026-08-19 | 44 |
| `c1b39149` | 2026-08-20 | 43 |
| `4594ab9f` | 2026-09-23 | 9 |

**143 open conversation threads: proposed disposition before Win-Back is unpaused.** Production split:

| Threads | Last message | Last activity | AI-armed |
|---|---|---|---|
| 104 | outbound | 2026-08-03 to 2026-08-26, all over 30 days | 3 |
| 39 | none (no message) | — | — |

None has an unread inbound message. After E-06, Win-Back pauses only on a thread whose last message is **inbound**, so
none of these would pause it.

Proposal, an owner-run status change that deletes nothing:

1. Set the 39 empty threads and the 104 outbound-last threads older than 30 days to `closed`.
2. Disarm `ai_autoreply` on the 3 armed threads unless the FSA wants them live.

A later client reply reopens a thread (`touchConversation` sets `open` on inbound).

**Operating-documentation difference (decision 7).** Term conversion, cross-sell and win-back now send only through
their campaign engines (Life Conversion, Cross-Sell Life, Pipeline Win-Back). The workforce agents `term_conversion`,
`cross_sell` and `life_winback` stand down; the roster and command center show "Stands down — campaign owns audience".
Operating documentation that routes these through the `term_conversion` / `marketing_automation` agents is now out of
date.

**How production was read.** The claude.ai Supabase connector (`execute_sql`) on project `ynxaqeejjmeilpwmuuie`,
connecting as role `postgres` (`rolbypassrls = true`, not superuser, not read-only). **The path can write.** Every
statement was a SELECT, and since the checkpoint each has been wrapped in `begin read only … commit`.

**Supabase Preview / Vercel Preview.** The PR now carries migrations. The Supabase "Preview" check on PR #322 reports
**skipped**, and `list_branches` shows only `main` (status `MIGRATIONS_FAILED` since 2026-09-03). No branch database
was created.

I could not read what Vercel Preview deployments use for their database and provider keys: the Vercel connector returns
403/404 for the project. **Risk:** if Preview env vars point at the production Supabase project or live
Twilio/Resend keys, a Preview deployment of this branch would run its crons and webhooks against production.
Vercel runs crons only on production deployments (ASSUMPTION from Vercel's documented behaviour; not verified for
this project).

**Proposal:** give Preview an isolated Supabase branch (fix the `MIGRATIONS_FAILED` integration, or a separate dev
project), set `COMMS_CAPTURE_TRANSPORT` and no provider keys on Preview, and use that for E2E.

## 7. Verification (three buckets)

**CODE-VERIFIED** (run in this session, output in the session log):

- `npm test`: the full unit set, 239 files passed, 0 pinned (after the review fixes).
- `npm run type-check`: clean.
- `npm run lint`: "No ESLint warnings or errors".
- `npm run test:rls` with `CI_REQUIRE_INFRA=1` (ephemeral local Postgres): **all 25 files passed** on the final head,
  after the review fixes. Individually re-run after the last
  changes: `comms-inbound-e2e` (150/150), `automation-migrations-rollback` (138–141 forward → rollback → re-apply),
  `booking-reminder-idempotency`, `booking-delivery-ledger`, `district-nurture-rls`, the workshop guarantee files.
- `npm run build`: see §9.
- Fail-before / pass-after: for most Phase C–E repairs, the new test was also run against the pre-change source and
  failed there. Not every Phase A/B test was re-checked that way.

**BROWSER-VERIFIED:** none.

**NOT VERIFIED, and why:**

- **Rendered UI.** Every surface changed is behind auth. A local Supabase stack could not start: Docker started, but
  image pulls failed (Docker Hub 429; ECR/GHCR blob hosts Forbidden through the session proxy). No Playwright session
  ran, so the UI changes are source-verified only.
- **Live provider behaviour** (canary checks C1–C10, inventory §9). The canary contacts were blank placeholders.
- **Production env values** (`SMS_A2P_APPROVED`, `CRON_SECRET`, Preview env). The Vercel connector has no access.
- **CI.** No GitHub Actions run was attached to the PR head at the last check; only the Vercel/Supabase checks reported.

## 8. Canary checks to run after deploy

These are inventory §9, C1–C10, unchanged. Prerequisite: the canary SMS number and email verified as
`comms_test_recipients` through `/app/comms`.

Additions for this branch:

- **C11** `callback_engine_state` → `canary`. Confirm a canary enrollment is unaffected by a `delivered` callback.
  21610 cannot be produced on demand; that branch is mock-verified only.
- **C12** `engine_retry_redispatch` stays `off`. It has no live check that avoids risking a duplicate; enable only on
  the owner's judgement.
- **C13** after setting `CRON_SECRET`: `/super/jobs` shows each daily job "Succeeded" within 26 h, and a request with
  only `x-vercel-cron` gets 401.

## 9. Final review, build, and remaining items

**Build.** `npm run build` completed with exit 0 (before the review-fix commit). The review fix touches only
server-side TypeScript, and the typecheck is clean after it.

**Final adversarial review.** A fresh `implementation-reviewer` that wrote none of the repairs reviewed the whole diff.

| # | Sev | Finding | Disposition |
|---|---|---|---|
| 1 | P0 | After a START lifted a keyword DNC row, a later web, portal or unsubscribe opt-out did not suppress again. Only the STOP writer refreshed `created_at`; the public route used `ignoreDuplicates`. A regression against main, where START deleted the row. | **Fixed** `37d495d`: every DNC writer re-arms; the public route no longer ignores duplicates. Test: `comms-optout-rearm`. |
| 2a | P1 | START created consent (decision 4 says restore only). | **Fixed** `37d495d`: consent is restored only from documented prior evidence (a contact grant before the opt-out, or the member grant the STOP writer now records on its revoke row). Otherwise START lifts the opt-out and creates nothing. Tests: `comms-stop-contact-consent`, e2e §3b/§4. |
| 2b | P1 | A STOP relabelled an existing unsubscribe/operator row as a keyword opt-out, making it START-liftable. | **Fixed** `37d495d`: an existing non-keyword reason is kept; an unreadable prior row gets a non-liftable reason. |
| 3a | P2 | Phone/ZIP zone disagreement: the ZIP zone alone now governs. The earlier flag-on mode required both. | **Owner question.** Decision 1 says "address, then area code". Narrowing to the intersection would be stricter; confirm intent. |
| 3b | P2 | An unresolved zone now sends inside the continental intersection; Alaska/Hawaii/foreign numbers are not covered. CLAUDE.md still describes a hard block. | **Owner question / CLAUDE.md update.** As decided (decision 1); listed in §10. |
| 4 | P2 | A broadcast's quiet-hours hold never expired (due = now). | **Fixed** `37d495d`: bounded from `schedule_at`, else `created_at`. |
| 5 | P2 | The Life / Win-Back (15:00 UTC) and Cross-Sell (16:00 UTC) ticks fall before 09:00 Pacific and Arizona, and are never inside the window for unresolved zones. With decision 2 those SMS touches are held each day, escalated, and written off after 72 h. | **Owner decision needed:** move these ticks to 17:00 UTC like decision 8 (a cron change is a hard stop). Pinned in `tests/cron-send-window.test.mjs`. |
| 6 | P3 | The floor also holds conversational SERVICING AI replies, wider than "campaign SMS". | Left as is. It fails safe and was chosen when widening the exempt set; owner may narrow. |
| 7 | P3 | "Most recent revoke wins" ignores a newer opt-in not recorded in `comm_contact_consents`. | Left as is. Over-restrictive, not looser. |
| 8 | P3 | A synchronous 21610 whose DNC write fails is only logged; there is no webhook to retry it. | Left as is. The next send gets 21610 again and retries the write. |
| 9 | P3 | Several reminder offsets can collapse onto one allowed tick; `skipped` recounts; mig 139 rollback resets every MARKETING row. | Noted. One offset is configured in production; the rollback restores the seeded state. |

The reviewer found no material findings in:

- monotonic status;
- the send-path guarded patch;
- orphan release (safe against a send that went out);
- cron auth;
- `job_runs` reclaim;
- `automation_switches` RLS and rollbacks;
- workforce stand-down;
- STOP-before-threading;
- the keyword classifier;
- provider error classification;
- the sampled UI copy.

**Remaining items for the owner:**

- set `CRON_SECRET`;
- apply migrations 138–141;
- decide review findings 3a, 3b and 5;
- answer the open questions in §5;
- provide verified canary contacts;
- isolate Preview (§6).

## 10. Out-of-scope findings (recorded, not acted on)

- Legacy AI FNA auto-generation (`forms/submit/route.ts` → `lib/fna.ts`) emits product-category recommendations and a
  risk profile with no red-line screen. The DB trigger `form_submission_profile_sync` writes Conservative/Moderate/
  Aggressive labels. AI red-line / securities question for the owner; the FNA off-switch task was not started.
- Unauthenticated open/click tracking endpoints accept any message UUID.
- `scripts/reset-campaigns.mjs --apply` re-activates Cross-Sell Life and restarts contacts at touch 1.
- 116 orphan Resend events: the sender is unidentified (decision: treat as P0 if it reaches clients).
- Supabase migration ledger out of sync (14 of 139 files recorded).
- Google Calendar shows "disconnected" (hard-coded) on `/super/integrations`, although booking has a calendar OAuth flow.
- **CLAUDE.md drift.**
  - CLAUDE.md cites `timezone_unresolved` at `src/lib/comms/gate.ts:290`. With decision 1, an unresolved zone no longer
    blocks: it evaluates every continental zone. The CLAUDE.md quiet-hours paragraph needs the owner's update.
  - The skills `twilio-a2p-compliance` and `fsos-deliverability` still describe the retired `sendThroughGate` path and a
    7-step gate.
- **Skills named by the brief but not installed:** `fsos-outbound-consent-gate`, `fsos-financial-compliance-firewall`,
  `fsos-data-security`.
