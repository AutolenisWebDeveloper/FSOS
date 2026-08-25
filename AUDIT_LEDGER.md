# FSOS — Phase 1 Read-Only Audit Ledger

Repository: AutolenisWebDeveloper/FSOS
Branch: claude/fsos-phase-1-audit-sgn0z0
HEAD SHA: 9f18d33ec46a8b43a9a575d3d22ce8fccfa84585
origin/main SHA: 9f18d33ec46a8b43a9a575d3d22ce8fccfa84585
Audit started: 2026-08-24
Last updated: 2026-08-24

> READ-ONLY AUDIT. Zero application/source edits. The only writable output is this file.
> Working tree at start: clean (branch == origin/main == origin default HEAD).

---

## ⛔ SEQUENCING BLOCKER (read first)

**The GHL excision that this audit presumes has landed has NOT run.** GoHighLevel is
fully present AND active in the codebase at HEAD. Per the task's SEQUENCING clause
("If GHL code is still present when you start, stop and flag it — the excision runs
first"), this is flagged as the headline precondition failure. The read-only audit of
the remaining subsystems was still performed (nothing here changes state), but
**subsystem-1 GHL-removal-verification = FAILED (not performed)**, and every "GHL is
gone" assumption in downstream subsystems is false. See **FSOS-001**.

---

## STATUS
- [x] Baseline
- [x] Communication dispatch & governance  (canonical path + GHL remnants FSOS-001; fail-closed template RESOLVED)
- [x] Campaign state machine  (reply-exit P0 = FSOS-020; dedup FSOS-021; tick fail-closed FSOS-010)
- [x] Inbound/status webhooks  (FSOS-030..032; FK reconciliation P0 = FSOS-030)
- [x] Booking/calendar  (FSOS-040..043)
- [x] AI agents  (FSOS-050 roster overstates surface; FSOS-051 governance solid)
- [x] Authentication/RLS  (FSOS-060..065)
- [x] Cron/scheduled jobs  (FSOS-070..076)

`[ ]` not audited · `[~]` partially audited · `[x]` deeply traced to this phase's evidence standard

## KNOWN P0 TRACKING
- [x] Reply-exit logic — CONFIRMED → FSOS-020 (soft opt-outs pause + auto-resume)
- [x] Fail-closed template fetch — NOT CONFIRMED as a defect; control correct on canonical path + all 4 tick engines → FSOS-010
- [x] Quiet-hours consistency — traced → FSOS-011 (consistent; one scoped caveat)
- [x] Message-of-record FK reconciliation — PARTIALLY PROVEN → FSOS-030 (model sound; orphan-on-null-provider_id; cannot corrupt campaign state)

## GHL REMOVAL VERIFICATION
**RESOLVED (GHL EXCISION: PASS)** as of 2026-08-24 — GHL removed as an FSOS runtime dependency
(0 imports / 0 API calls / 0 webhook+import routes / 0 ghl_* writes / 0 dependent reads); native
taxonomy + CSV mapping relocated provider-neutral; native referral/workshop behavior preserved;
all five gates green. Legacy ghl_* columns retained as dormant schema (cleanup deferred). See
FSOS-001 RESOLUTION. (Original FSOS-001 High finding preserved above for history.)

## TOP FINDINGS (severity × blast radius × launch relevance)
1. FSOS-001 (High) — GHL not excised; present + active. **Precondition blocker.**
2. FSOS-070 (High) — AI workforce orchestrator never scheduled → autonomous AI outreach dormant.
3. FSOS-071 (High) — 6 lifecycle-detection crons never scheduled (incl. referral-SLA escalations).
4. FSOS-060 (High) — API mutations don't enforce MFA/step-up (middleware excludes /api/).
5. FSOS-061 (High, systemic) — whole API runs as service role; RLS is not a backstop for API traffic.
6. FSOS-020 (High) — reply-exit: soft/natural-language opt-outs only PAUSE + auto-resume (KNOWN P0).
7. FSOS-050 (Medium) — AI roster shows ~7–9 agents with no reachable execution path.
8. FSOS-030 (Medium) — message-of-record FK reconciliation can orphan on null/late provider_id (KNOWN P0).
9. FSOS-042 (Medium) — same-day reschedule counts the appointment against itself (capacity/buffer self-block).
10. FSOS-062 (Medium) — agencies/upload is public + unauthenticated + service-role writes.
Medium/ops: FSOS-072/073/074 (unscheduled workshop-reminders/backup-verify + stale cron runbook).
Low/informational: FSOS-011 (quiet-hours TZ default), FSOS-041, FSOS-032, FSOS-063/064/065/075, FSOS-043.
Controls verified SOLID: FSOS-010 (fail-closed template), FSOS-021 (dedup), FSOS-031 (webhook sig/STOP),
FSOS-040 (booking guards), FSOS-051 (AI governance), FSOS-012 (transactional boundary), FSOS-076 (cron idempotency).

## REMAINING AUDIT SCOPE (not fully traced to this phase's standard)
- All 8 subsystems traced to the evidence standard. Depth caveats, not gaps:
  - Tick engines: life-campaign fully line-traced; cross-sell-life / pipeline-winback /
    district-nurture confirmed by shared fail-closed guard + shared migration constraints +
    dedicated regression tests (parity), not each line-traced end to end.
  - Auth: F1/F2 (FSOS-060/061) independently spot-verified by the lead; the per-route MISSING-authz
    sweep across all ~230 routes was representative, not exhaustive — a full per-route matrix is
    recommended in triage.
  - AI roster: 4 keys (agency_growth/case_management/document_intelligence/commission_reconciliation)
    proven refs=0; the "routing-label-only" classification of executive_intelligence/agency_activation/
    referral_triage/pipeline is HYPOTHESIS-grade (no runAgent found, intended-live unconfirmed).
- ALL live/runtime behavior is NOT VERIFIED — LIVE REQUIRED (no creds/deployed infra in sandbox):
  actual provider sends (Twilio/Resend), Vercel cron execution, pg_cron enablement, Google freeBusy,
  Zoom provisioning, and whether migrations 069/091/119/079/081/083/085/089/112 are APPLIED in prod.

---

## INTEGRATION EPISTEMICS (evidence classes)
- Twilio (SMS), Resend (email), Supabase (Postgres/Auth/RLS), Vercel cron, Zoom,
  Google/Microsoft calendar OAuth, GoHighLevel, Anthropic gateway.
- No live credentials or deployed infrastructure available in this sandbox. All provider
  behavior is **CODE VERIFIED** or **NOT VERIFIED — LIVE REQUIRED**. No LIVE verification
  is claimed anywhere in this ledger.

---

## BASELINE VALIDATION

Environment: Node v22.22.2 · npm 10.9.7 · lockfile package-lock.json (present) · `npm ci` clean (exit 0).

| Gate | Command | Exit | Result | Classification |
|---|---|---|---|---|
| Install | `npm ci` | 0 | clean install | — |
| Type-check | `npm run type-check` (`tsc --noEmit`) | 0 | PASS | repo |
| Unit tests | `npm run test` (`node scripts/run-tests.mjs unit`) | 0 | PASS — "All 183 unit test file(s) passed." | repo |
| RLS tests | `npm run test:rls` | 0 | PASS — "All 14 rls test file(s) passed." (runs on an EPHEMERAL local Postgres, no live infra needed) | repo |
| Lint | `npm run lint` (`next lint`) | 0 | PASS — "No ESLint warnings or errors" | repo |
| Build | `npm run build` (`next build`) | 0 | PASS — optimized production build (Next.js 15.5.22) | repo |

Notes:
- Custom runner (`scripts/run-tests.mjs`), not jest/vitest. Unit suite = 183 files, all green.
- test:rls spins up an EPHEMERAL Postgres locally (no live credentials required) and passed —
  14 rls test files green. Build compiled clean. **All five gates green; baseline is clean.**
- `next lint` prints a deprecation notice (removed in Next 16) but exits 0 — not a defect.

---

## FINDINGS

### FSOS-001 — GHL excision not performed: GoHighLevel present and ACTIVE at HEAD
Severity: High
Subsystem: 1 (Comms governance) / cross-cutting
Status: PROVEN

Observed:
GoHighLevel is fully present and reachable at runtime — the opposite of the excised
state this audit presumes. Concretely:
- `src/lib/ghl.ts` (15,951 B) and `src/lib/ghlContacts.ts` (12,577 B) both still exist.
- Live external API path: `ghlEnabled()` returns true whenever `GHL_API_KEY` is set
  (`src/lib/ghl.ts:248-249`); `ghlFetch` calls `https://services.leadconnectorhq.com`
  (`src/lib/ghl.ts:240,264-271`).
- `src/app/api/agencies/referral/route.ts:113` actively branches on `ghlEnabled()` and
  calls `upsertContact` (`:116`) and `createOpportunity` (`:132`), then writes
  `ghl_contact_id` / `ghl_opportunity_id` (`:141-142`).
- Live GHL routes still mounted: `src/app/api/ghl/sync/route.ts`,
  `.../ghl/sync-record/route.ts`, `.../ghl/contacts/upload/route.ts`,
  `src/app/api/webhooks/ghl/route.ts` (inbound receiver, HMAC on `x-ghl-signature`),
  `src/app/api/admin/imports/ghl/route.ts`.
- `src/app/api/public/workshops/feedback/route.ts:80-90` routes leads to GHL
  (`outcome.routed === 'ghl'`) and writes `ghl_opportunity_id`.
- Active `ghl_*` column reads/writes: `src/app/api/scores/route.ts:28`
  (`ghl_contact_id, ghl_opportunity_id, ghl_stage_id, ghl_pipeline_id`),
  `contacts/upload` uses `ghl_upload_batches` / `ghl_upload_rows`.
- Pipeline/stage taxonomy (`PIPELINES`, `ghlSummary`, `findStageById`, `Pipeline`) still
  lives in `@/lib/ghl` and is imported by ~15 consumers: dashboard, search, scores, opra,
  agencies/list, customerProfile, ai/contactRouter, contacts/upload, workshops, admin UI.

Expected:
Per SEQUENCING: no `@/lib/ghl` imports in `src/`; `ghl.ts`/`ghlContacts.ts` deleted;
taxonomy relocated to an internal module with all consumers repointed; GHL routes and the
webhook receiver removed; `agencies/referral` no longer calling GHL; no active path
reading `ghl_*`.

Root cause: PROVEN — the excision task described in the SEQUENCING clause has not been
performed against this branch/HEAD.

Blast radius:
Every downstream subsystem's "GHL is gone" assumption is invalid. Referral intake,
contact import, agency sync, workshop lead routing, scoring, dashboard summaries, and the
AI contact router all still traverse GHL code. A configured `GHL_API_KEY` makes these live
outbound calls; an attacker-known webhook path exists (signature-checked — see subsystem 3).

Evidence:
- src/lib/ghl.ts:240,248-249,264-271
- src/app/api/agencies/referral/route.ts:6,113,116,132,141-142
- src/app/api/webhooks/ghl/route.ts:1-30
- src/app/api/ghl/{sync,sync-record,contacts/upload}/route.ts
- src/app/api/admin/imports/ghl/route.ts:169-245
- src/app/api/public/workshops/feedback/route.ts:45,80-90
- src/app/api/scores/route.ts:28
- ~15 `@/lib/ghl` / `@/lib/ghlContacts` import sites across src/ (grep verified)

Dependent workflows: referral→case, contact import, agency sync, workshop feedback→lead,
scoring, dashboard, AI contact routing.

Suggested fix direction: run the GHL excision (Phase 0) BEFORE this audit's Phase 2. Do
NOT repair here.

Verification needed: after excision — zero `@/lib/ghl(Contacts)?` imports in src/; files
deleted; routes 404; no `ghl_*` read on an active path; taxonomy resolved from the internal
module; unit + type-check green.

---

### FSOS-001 — RESOLUTION (Pre-Phase-2 GHL excision) — RESOLVED
Status: RESOLVED (GHL EXCISION: PASS) · verified 2026-08-24
Baseline SHA: 204c5a278da20e360a0139f5285821e0580e1a5b · Implementation on branch
claude/fsos-phase-1-audit-sgn0z0.

The original finding above is preserved. GoHighLevel has been excised as an FSOS runtime
dependency. Evidence:

REMOVED (integration):
- Libraries: src/lib/ghl.ts, src/lib/ghlContacts.ts (deleted).
- Routes: src/app/api/ghl/{sync,sync-record,contacts/upload}, src/app/api/webhooks/ghl,
  src/app/api/admin/imports/ghl, src/app/api/app/contacts/upload (GHL-only outbound sync).
- UI: (fsa)/app/contacts/upload/page.tsx, ContactUploadForm, (admin)/.../imports/ghl/page.tsx,
  GhlImportWizard, GhlSyncButton; admin "Import GHL contacts" link; super/health GHL card;
  health route `ghl_key`; GhlSyncSchema/GHL_SYNC_ENTITY/GHL_PIPELINE_KEY.
- Feature flag: `ghlEnabled()`/`GHL_API_KEY` gate removed (no code reads it).

RELOCATED (FSOS-native, provider-neutral):
- src/lib/pipelines.ts ← taxonomy from ghl.ts: Pipeline/PipelineStage/PipelineKey/InternalPipeline,
  PIPELINES, findStageById, findPipelineById, stageAt, isApplicationSubmittedStage/isIssuedStage,
  APPLICATION_SUBMITTED_STAGE_IDS/ISSUED_STAGE_IDS, and pipelineSummary (was ghlSummary).
- src/lib/import/csv-mapping.ts ← ghlContacts.ts (GHL_CUSTOM_FIELDS coupling inlined as plain keys).
- Consumers repointed: dashboard, search, scores, opra, agencies/list, customerProfile,
  ai/contactRouter, import/mapping/commit, columnAI, app/contacts/import.

WORKFLOW PRESERVATION:
- agencies/referral: native customer + agency_referrals + activity + questionnaire all intact;
  only the best-effort GHL contact/opportunity MIRROR (+ ghl_* writes) removed. No native loss.
- workshops convertRegistrationToLead: securities firewall → FFS preserved (compliance_event +
  escalation); non-securities now marks the native conversion (lead_converted_at) idempotently,
  routed:'native'. Native internal referral still created by routeSegmentToSpine/registrations
  route (`referrals` insert). lead_score/segment unchanged.
- feedback + registrations/[id] routes updated to the native path; no ghl_* writes.
- Workshop conversion ANALYTICS migrated from a dependent read on ghl_opportunity_id to the
  native lead_converted_at marker (attendance.ts, analytics-server.ts) so counts stay correct.

DATABASE (dormant schema/history retained; CODE EXCISION NOW / SCHEMA CLEANUP LATER):
- ghl_* WRITES: 0. ghl_* DEPENDENT READS: 0.
- Retained DORMANT READs (display-only, no behavior branch): pipelineSummary reads historical
  ghl_stage_id/ghl_contact_id/ghl_opportunity_id (documented in src/lib/pipelines.ts);
  scores/route.ts:28, opra/route.ts:43,129 SELECT those columns to feed the summary;
  customers/next-action ghl_stage/ghl_pipeline output fields; audit/route.ts:29 lists historical
  ghl_upload_batches. types/database.ts retains the ghl_* column types (mirror of live schema).
- Legacy ghl_* columns + ghl_upload_batches/ghl_upload_rows tables LEFT as dormant schema
  (physical column/table removal deferred to a separate authorized migration).

ZERO-RUNTIME-DEPENDENCY VERIFICATION (grep, post-change):
- @/lib/ghl imports: 0 · @/lib/ghlContacts imports: 0 · GHL API calls (leadconnectorhq/
  upsertContact/createOpportunity/ghlEnabled): 0 · GHL webhook routes: 0 · GHL import routes: 0 ·
  ghl_* writes: 0 · ghl_* dependent reads: 0 · GHL-required app env references: 0 ·
  GHL feature-flag deps: 0. Remaining textual refs are: dormant reads (above), the retained
  MIGRATION/HISTORY module src/lib/comms/migration/ghl-optout.ts (+ its 2 tests), types/database.ts
  dormant columns, provider-neutral module docs, and stale-comment cleanups.

TESTS:
- New: tests/pipelines-taxonomy.test.mjs (11 assertions — taxonomy + summary parity),
  tests/csv-mapping.test.mjs (20 assertions — mapping/inference parity). Both prove PRESERVED
  behavior. Removed tests/ghlUpload.test.mjs (compiled the deleted ghl.ts/withGhlRetry).
- Updated tests/workshop-ops.test.mjs: replaced the assertion for the removed GHL push with one
  asserting the native conversion (lead_converted_at, routed:'native', no GHL_CUSTOM_FIELDS);
  updated a conversion-count fixture to the native marker. No assertion weakened.

VALIDATION (all green): type-check exit 0 · `npm test` 184/184 unit files · `npm run test:rls`
14/14 rls files (ephemeral Postgres) · lint exit 0 (no ESLint warnings/errors) · build exit 0.

WORKFLOW-GAP NOTE (not a §5A blocker): the former GHL-side OPPORTUNITY / pipeline PLACEMENT for
referral + workshop leads had NO pre-existing native equivalent (FSOS created only a GHL
opportunity, never a native `opportunities` row, for these). It is intentionally dropped — the
FSOS-native lead artifacts (customer/contact, agency_referrals or referrals row with SLA,
activity, lead_converted_at) remain complete and actionable, so no workflow is silently
incomplete. Building a native opportunity/pipeline-placement mechanism for these leads is a
product decision explicitly OUT OF SCOPE for this excision run; flagged here for triage.

INDEPENDENT REVIEW (completed): an independent adversarial review of the diff confirmed
**zero surviving GHL runtime dependency, no confirmed native loss, securities firewall intact
in all three paths, byte-faithful taxonomy relocation, complete consumer migration, dormant
(not dependent) ghl_* reads, and tests that prove preserved behavior (none weakened).** Three
Low findings were raised and all fixed within excision scope:
- (Low) Manual convert-to-lead emitted no audit when the referral already existed →
  FIXED: registrations/[id] route now writes an explicit `entity.updated {converted:true}`
  audit on a newly-marked native conversion.
- (Low) Native conversion DB write was unchecked (silent-success on a transient failure) →
  FIXED: convertRegistrationToLead now returns `{ok:false,status:500}` on the update error and
  the manual route surfaces it for retry (fail-closed, matching the prior GHL-push semantics).
- (Low, nit) Stale comments referencing removed GHL → FIXED (agencyDirectory.ts, scores/route.ts).
Re-validated after the fixes: type-check + workshop suites green (full gate re-run below).

NOT VERIFIED — LIVE/ADMIN REQUIRED (out of repo scope):
- Remove GHL_API_KEY / GHL_LOCATION_ID from Vercel/production env (names for admin cleanup:
  GHL_API_KEY, GHL_LOCATION_ID, GHL_WEBHOOK_SECRET).
- Disable provider-side GHL webhooks/workflows; GHL account contacts/opportunities; deployment
  of this branch; physical drop of legacy ghl_* columns + ghl_upload_* tables (separate migration).
  For each: Required access (Vercel/GHL admin, Supabase migration) → action → expected evidence
  (env absent / webhook 404 at GHL / columns dropped) → pass condition.

---

### FSOS-010 — Fail-closed template fetch: canonical send path PROVEN fail-closed (tick engines pending)
Severity: (informational so far — P0 known-issue disposition)
Subsystem: 1
Status: PARTIALLY PROVEN

Observed (canonical path `sendThroughGate` — src/lib/comms/send.ts):
The single send choke-point fails closed on every template-failure mode the P0 names:
- Template does not exist / retrieval fails / inactive-unapproved → `isTemplateApproved()`
  returns false (missing id, non-`approved` status, `archived_at` set, OR any thrown error)
  (send.ts:278-290); gate step 4 `approved_template` then BLOCKS unless another approved
  basis holds (send.ts:789-792, gate.ts:250).
- Rendering yields an empty/whitespace body → blocked before the branded-shell wrap
  (send.ts:670-698) AND by the pure gate `message_content` backstop (gate.ts:212-215) AND
  by the provider-boundary backstop in messaging.ts (sendEmail:52, sendSms:101).
- Required merge data missing → `unresolvedBlockingTokens` → gate step `personalization`
  hard-blocks + escalates (send.ts:598-603,1064-1067; gate.ts:255).
- Legacy drip runner passes `campaigns.template_id`; null → gate blocks `approved_template`
  → enrollment stopped (campaigns/run/route.ts:33,86-121).

The one relaxation (`approvedHumanTemplate`, send.ts:1061) only relaxes the recommendation
red-line for a real approved template id on a non-AI send; it never relaxes step 4 itself.

Not yet traced: the named-campaign tick engines (life-campaign, cross-sell-life,
pipeline-winback, district-nurture) — whether each routes template resolution through
`sendThroughGate` with a real templateId, or whether any builds a body from a template and,
on fetch failure, substitutes a hardcoded fallback body while asserting approval. Tracked
in subsystem 2.

Root cause: n/a (control appears correct on the canonical path).

Evidence:
- src/lib/comms/send.ts:278-290,598-603,660-698,789-792,1057-1067
- src/lib/comms/gate.ts:198-215,250,255
- src/lib/messaging.ts:50-52,96-104
- src/app/api/campaigns/run/route.ts:33,86-128

Verification needed: trace each tick engine's send call; confirm templateId provenance and
absence of any fallback-body-with-approval path.

---

### FSOS-011 — Quiet-hours consistency: single-sourced window; one scoped timezone caveat
Severity: Low (caveat) / otherwise consistent
Subsystem: 1
Status: PROVEN

Observed:
Quiet hours are consistent across every client-facing send path:
- ONE window definition: `withinQuietHours(h) = h >= 9 && h < 20`
  (src/lib/compliance/guardrail.ts:66-68), consumed by both the pure gate (gate.ts:230) and
  the AI validator `validateAIClientMessage` (guardrail.ts:113).
- ONE timezone resolution: `recipientLocalHour()` in send.ts:270-275 → DST-correct
  `localHourInTimeZone()` via `Intl` (local-time.ts:21-33), default `America/Chicago`.
- ONE scope rule: `quietHoursApply(channel, purpose)` (purpose.ts:85-89) — email always
  exempt; SMS transactional/servicing exempt; SMS marketing/unclassified gated. Human-typed
  1:1 SMS additionally exempt ONLY within a 24h live-conversation window, resolved
  server-side and failing closed (send.ts:803-806, local-time.ts:44-52).
- Schedulers do NOT re-implement the window — pipeline-winback/schedule.ts:16-18 explicitly
  delegates recipient-local quiet-hours to the send-time gate.

Caveat (the one real gap): when a recipient's timezone is unknown, the local hour defaults
to the practice's home zone (America/Chicago), NOT the recipient's actual zone
(local-time.ts:14,21; send.ts:274). For a McKinney-TX Central-heavy book this is a
reasonable default, but an out-of-Central recipient's SMS marketing quiet-hours floor is
evaluated against Central time. Only the workshop engine supplies a real per-recipient
offset; campaign ticks pass none → Central default.

Expected: for strict TCPA correctness, quiet hours should key off the recipient's actual
local time when derivable (area code / address / stated zone).

Root cause: HYPOTHESIS — no recipient-timezone derivation exists on the campaign paths;
the Central default stands in.

Blast radius: SMS marketing/campaign/relationship/birthday sends to recipients outside
Central time whose zone FSOS does not know — evaluated against Central quiet hours.

Evidence:
- src/lib/compliance/guardrail.ts:66-68,108-117
- src/lib/comms/gate.ts:230-232
- src/lib/comms/local-time.ts:14,21-33
- src/lib/comms/send.ts:270-275,794-806
- src/lib/comms/purpose.ts:85-89
- src/lib/pipeline-winback/schedule.ts:16-18

Suggested fix direction: derive recipient timezone where possible; keep Central as an
explicit last-resort default. DO NOT IMPLEMENT.

Verification needed: unit test asserting an out-of-zone recipient is gated on their local
hour; confirm each tick engine's timeZone/utcOffset provenance.

---

### FSOS-012 — Transactional email bypasses the marketing gate (by design; recorded for completeness)
Severity: Low (informational)
Subsystem: 1
Status: PROVEN

Observed:
Direct `sendEmail`/`sendSms` callers outside the dispatcher were enumerated. All are
transactional/internal EMAIL, and every SMS path routes through `sendThroughGate`:
- notifications/transactional.ts (visitor acks + FSA internal alerts) — email only.
- notifications/account.ts:107 (password-setup) — email only.
- api/briefing/send/route.ts:122 (internal operator digest) — email, internal recipient.
- api/workshops/register/route.ts:120 (registration confirmation) — email only.
- lib/forms.ts:137 (form-link email) transactional; forms.ts:178 SMS → `sendThroughGate`.
The provider wrapper (messaging.ts) enforces empty-body + A2P backstops but NOT
consent/DNC/quiet-hours; those transactional emails are intentionally exempt from the
marketing gate and the `consents` table (documented CAN-SPAM boundary). No client-facing
MARKETING/campaign send was found bypassing the gate.

Root cause: n/a — considered design boundary.

Blast radius: transactional emails (receipts/acks/alerts/account/briefing) are not
DNC/unsubscribe-checked. This is CAN-SPAM-legitimate for genuinely transactional mail; the
risk is only if a marketing payload were ever routed through these helpers (none found).

Evidence:
- src/lib/notifications/transactional.ts:9-13,22,108-155
- src/lib/notifications/account.ts:107
- src/app/api/briefing/send/route.ts:119-122
- src/app/api/workshops/register/route.ts:120
- src/lib/forms.ts:137-140,162-183
- src/lib/messaging.ts:38-126

Suggested fix direction: none required; keep marketing payloads off these helpers. Optional
hardening: assert purpose=transactional at these call sites. DO NOT IMPLEMENT.

Verification needed: confirm no marketing/campaign caller reaches these helpers.

---

### FSOS-020 — Reply-exit: soft/natural-language opt-outs only PAUSE and are AUTO-RESUMED (KNOWN P0: CONFIRMED)
Severity: High
Subsystem: 2 (Campaign state machine) / 1 (governance)
Status: PROVEN

Observed:
A qualifying customer reply does NOT terminate campaign continuation — it PAUSES, and the
daily `resume-paused` cron auto-resumes it. Opt-out is recognized ONLY by an exact carrier
keyword as the message's FIRST WORD:
- `classifyKeyword` matches STOP only when the first token (letters only) is one of
  stop/stopall/unsubscribe/cancel/end/quit/optout/revoke (keywords.ts:8,12-18).
- Only `intent==='stop'` runs `optOutActiveEnrollments` → terminal `opted_out`/`exited`/
  `suppressed`, never resumed (inbound.ts:301-322,148-189). CORRECT for exact STOP.
- EVERY other reply → `shouldPauseOnReply` true (conversation-mode.ts:58-60) →
  `pauseActiveEnrollments` sets `paused_for_conversation` across native drips + all three
  multi-channel campaigns (inbound.ts:332-343, 99-133).
- `resume-paused` cron (vercel.json `0 11 * * *`) → `resumePausedEnrollments` returns paused
  rows to their live status with `next_send_at/next_touch_at = now` whenever `evaluateResume`
  says so (handlers.ts:256-347).
- `evaluateResume` resumes on: manual resume, OR conversation status resolved/closed, OR
  **customer quiet ≥ resume_quiet_days (default 5)** (conversation-mode.ts:36-50;
  handlers.ts:259-260,277-281). Conversation status defaults to 'open' when absent, so the
  quiet-days branch is the operative auto-resume path.

Consequence: a customer who declines in natural language — "please stop" (first word
"please"), "not interested", "remove me", "no thank you", "stop calling me", or an angry
complaint — is NOT opted out. They are paused, then automatically re-enrolled ~5 quiet days
later and the cadence resumes. The reply classifier (reply-classification.ts) flags such
messages `complaint_or_dispute`/urgent and holds the AI reply for the FSA, but it has NO
path that terminates the enrollment — the opt-out decision is purely first-word-keyword.

The only backstop is the `inbound_awaiting_reply` / urgent FSA escalation (inbound.ts:
360-361,475), which is NOT required to be resolved before auto-resume — resume is purely
time/quiet-based and independent of whether the FSA acted.

Expected:
A clearly-expressed opt-out request should terminate automated campaign continuation
regardless of exact keyword ("reasonable means" of opt-out under TCPA/TRAIGA and CAN-SPAM
intent). At minimum, negative-intent/complaint replies should suppress auto-resume until an
FSA explicitly clears the escalation.

Root cause: PROVEN — opt-out intent detection is exact-first-word-carrier-keyword-only
(keywords.ts), while all non-keyword replies share one neutral pause+auto-resume path
(conversation-mode.ts + handlers.ts). No negative-sentiment/opt-out termination path exists.

Blast radius: every contact in every SMS/email campaign (native drips, Life Conversion,
Pipeline Win-Back, Cross-Sell Life, District Nurture) who soft-declines without the exact
first-word keyword. Regulatory (TCPA/TRAIGA/CAN-SPAM) and reputational exposure: FSOS
re-contacts people who asked it to stop.

Evidence:
- src/lib/comms/keywords.ts:8,12-18
- src/lib/comms/conversation-mode.ts:36-50,58-60
- src/lib/comms/inbound.ts:99-133,148-189,301-343,354-362,464-476
- src/jobs/handlers.ts:256-347 (resumePausedEnrollments; quiet-days auto-resume)
- vercel.json (resume-paused `0 11 * * *`)
- src/lib/comms/reply-classification.ts:126-141,289 (complaint/urgent detected but not terminal)

Dependent workflows: all campaign enroll→advance loops; the FSA escalation queue; consent
ledger (only exact STOP writes a revoke/DNC — a soft opt-out writes neither, so the gate
does NOT block the resumed sends either).

Suggested fix direction (DO NOT IMPLEMENT): (a) broaden opt-out detection to natural-language
intent (or a wider phrase set), routing it to `optOutActiveEnrollments` + DNC; and/or
(b) make auto-resume conditional on FSA resolution when the paused reply was classified
complaint/urgent/negative. Note the exact-keyword STOP path is correct and must remain.

Verification needed: unit test — "please stop" / "not interested" / an angry complaint must
terminate (not pause) enrollment or block auto-resume; confirm resume-paused does not
re-enroll a negatively-classified contact.

--- RESOLUTION (Phase 2 · Batch 1a) — RESOLVED — CODE VERIFIED ---
Branch: claude/fsos-phase-2-batch-1a (base origin/main 512b163853afce92f74932585cf02e79486fc249)

Root cause (confirmed as Phase-1): opt-out intent was recognized ONLY by a first-word carrier
keyword (keywords.ts); every other reply — including natural-language stop requests — shared one
neutral pause path (paused_for_conversation) that the resume-paused cron re-activated after the
quiet window. No campaign-termination state existed short of the global carrier opt-out.

Fix (minimal separation of GLOBAL/CHANNEL OPT-OUT vs CAMPAIGN TERMINATION):
- NEW pure, high-precision detector `detectStopAutomation(body)` (src/lib/comms/stop-intent.ts):
  category B stop-automation requests ("please stop texting me", "remove me", "opt out", "leave
  me alone") and category C clear disinterest ("not interested", "not a good fit"), with negation
  guards ("can't stop texting you", "non-stop") so benign replies never match.
- processInbound (src/lib/comms/inbound.ts): on a detected stop/decline (after carrier stop/start,
  before the benign pause block) it now (1) TERMINATES the member's enrollments across all campaign
  tables via terminateActiveEnrollments (terminal `opted_out`/`exited`/`suppressed`, exit_reason
  `reply_stop_request`), (2) writes INDIVIDUAL BUSINESS suppression (comm_client_suppressions via
  the audited comm_suppression_apply RPC) — the send-gate absorbing signal — and (3) escalates to
  the FSA (human handoff) + audits + logs, then returns. It writes NO DNC and revokes NO consent,
  so this is CAMPAIGN TERMINATION distinct from the carrier global opt-out (applyOptOut, unchanged).
- Carrier STOP path unchanged (renamed optOutActiveEnrollments→terminateActiveEnrollments with an
  exitReason param; carrier STOP passes 'opted_out' and still applyOptOut → DNC + consent revoke).

Absorbing (durability) — traced + tested:
- resume-paused selects only `paused_for_conversation` → terminal states never re-selected.
- tick engines select only the live status → terminal never advanced.
- same-version re-enrollment blocked by `unique (campaign_id, member_id)`.
- retries / AI workforce / cross-version re-enrollment: EVERY automated client-facing send flows
  through sendThroughGate → business-suppression check (fail-closed) → withheld. Proven by an e2e
  gate assertion (blockedStep 'suppression').
- Anti-over-correction: a benign conversational pause still resumes (proven by running the real
  resume-paused job after a benign reply → enrollment returns to 'enrolled').
- No new reader needed: terminal enrollment states are already respected by resume/ticks; the new
  signal is read by the EXISTING gate.

Files changed: src/lib/comms/stop-intent.ts (new), src/lib/comms/inbound.ts;
tests/comms-stop-intent.test.mjs (new, 64 assertions), tests/comms-inbound-e2e.test.mjs (+scenarios
3c/3d), tests/helpers/build-inbound-bundle.mjs (export resumePausedEnrollments),
tests/helpers/postgrest-shim.mjs (add .rpc()).

Tests (RED→GREEN): the pure battery failed before stop-intent.ts existed; the e2e 3c assertions
(terminal, not paused) fail against pre-fix code (reply → paused_for_conversation). Post-fix:
- Unit: comms-stop-intent 64/64 (B/C positive, benign/negation/coverage negative).
- e2e (real Postgres): NL-stop → opted_out (not paused); NO DNC / consent still granted; business
  suppression 'blocked' written; resume-paused does NOT resurrect; duplicate inbound idempotent;
  send gate withholds automated outreach (blockedStep 'suppression'); benign pause STILL resumes.

Validation (all green on the branch): type-check 0 · unit 185/185 · test:rls 14/14 (incl. the
extended inbound e2e, 138 checks) · lint 0 · build 0.

Regression protection confirmed: GHL runtime deps still 0; carrier STOP unchanged; quiet-hours,
fail-closed templates, dedup, and the canonical gate untouched; no direct provider calls added.

Independent review disposition: an adversarial review confirmed the CORE mechanism is sound
(terminal enrollment states + business suppression at the canonical gate) and raised 7 findings —
all in the natural-language detector's precision/coverage, none in the termination mechanism. Fixed
and re-proven by the expanded battery (64/64):
- F1 negation adjacency — "please don't ever stop texting me" / "I never want you to stop sending
  updates" false-terminated. Fixed: negation guard rewritten to a filler-whitelist NEGATED_INTENT
  (tolerates a small closed set of filler words between negator and cease verb) so a negated cease
  is suppressed while a genuine cease in a later clause is not.
- F3 disinterest over-match — "not interested in the premium option, but tell me about the basic
  plan" (sub-topic, still engaged) and "not interested in stopping" (meaning-flip) terminated. Fixed:
  `(?!\s+in\b)` lookahead on both interested patterns.
- F4 opt-out/unsubscribe bypassed negation — "I don't want to opt out" / "not interested in
  unsubscribing" terminated. Fixed: opt-out/unsubscribe/leave/cancel added to NEGATED_INTENT, plus an
  "interested in <ceasing>" guard for the object-of-interest case.
- F5 contact correction — "don't email me at that address, use my gmail" (a fix, not a cease)
  terminated. Fixed: `(?!\s+(?:at|on)\b)` lookahead on the "don't <verb> me" pattern.
- F6 missed stops — "I want to unsubscribe", "please stop", "please remove me", "remove me", "lose
  my number" auto-resumed. Fixed: broadened STOP patterns (`(please|pls|kindly) stop` w/ "stop by"
  exclusion; `unsubscrib\w*`; `(take|remove|delete) me`; `(remove|delete|lose) (my) number|info…`).
- F7 test-battery gaps — added all the above as explicit positive/negative cases (52 → 64).
- F2 (PLAUSIBLE, not a defect) absorbing guarantee — the send-gate suppression LAYER is conditional
  on resolving a contact identity (member.source_contact_id, else phone/email). Documented, not
  "fixed": the PRIMARY invariant is the terminal enrollment state (always applied for a member and
  never re-selected by resume/ticks); business suppression is defense-in-depth for
  re-enrollment/retries/AI-workforce. The inbound header comment now states this precisely rather
  than claiming suppression covers every case unconditionally.
No finding touched the termination mechanism, the gate, carrier STOP, or benign pause/resume; all
fixes are contained to stop-intent.ts (detector) + one clarifying comment in inbound.ts.

NOT VERIFIED — LIVE REQUIRED: real inbound SMS/email (Twilio/Resend) exercising the path in
production; the resume-paused Vercel cron actually firing against production data; confirming
`comm_suppression_apply` behaves identically on the production Supabase instance.

Status: RESOLVED — CODE VERIFIED (runtime unverified per above).

---

### FSOS-021 — Campaign state machine: enrollment dedup & duplicate-send prevention are SOUND (no defect)
Severity: Informational (control verified)
Subsystem: 2
Status: PROVEN

Observed:
The named-campaign engines have real DB-backed idempotency and dedup:
- Parallel/duplicate enrollment prevented by `unique (campaign_id, member_id)` on every
  enrollment table (migrations 081:99, 083 analog, 085:147, 112 analog, legacy 009:367).
  The tick's enrollSweep relies on it explicitly (life tick.ts:160-162,199-205).
- Duplicate-send prevented by `unique (enrollment_id, touch_no)` on the execution/touch
  tables (081:113,134; 083:122,143; 085:168,188; 112:95,115). The tick CLAIMS the execution
  row via insert BEFORE sending; a duplicate insert fails → `alreadyFired` → advance cursor,
  never send twice (life tick.ts:126-145). Plus a partial `unique idempotency_key`
  (mig 089:35; key `campaign:enrollment:touch:channel`, tick.ts:270).
- One touch per run (no burst/catch-up); eligibility re-checked before every touch;
  securities/opt-out → suppress/exit; SMS A2P hold defers without consuming the touch
  (tick.ts:99-146,117-124,251-254).
- Legacy drip (`/api/campaigns/run`) advances by `current_step` with `next_send_at` gating;
  HARD compliance blocks stop the enrollment, deferrals retry (campaigns/run/route.ts:33,
  115-146).

Evidence: supabase/migrations/{081,083,085,112}_*.sql; src/lib/life-campaign/tick.ts:126-208;
src/app/api/campaigns/run/route.ts:33,115-146. Regression: tests/campaign-template-failclosed.test.mjs,
tests/campaign-message-of-record.test.mjs.

Note: unintended AUTOMATIC enrollment is bounded by daily_enrollment_limit + eligibility view
(v_conversions_due only surfaces real deadlines). No unbounded auto-enroll found.

---

### FSOS-010 (UPDATE) — Fail-closed template fetch: CONTROL CORRECT across canonical path + all 4 tick engines
Status: RESOLVED (P0 known-issue = NOT CONFIRMED as a defect)

The tick engines fail closed identically to the canonical send path:
- Life Conversion: `!template_id || !isTemplateApproved` → skip; null/invalid-channel/empty-body
  → skip WITHOUT dispatch (tick.ts:222-245).
- Cross-Sell Life: same guard (cross-sell-life/tick.ts:171-172,180).
- Pipeline Win-Back: same guard (pipeline-winback/tick.ts:210-211,222).
- District Nurture: same guard incl. template_body_empty (district-nurture/tick.ts:238-250,277).
Each has a dedicated regression test (tests/campaign-template-failclosed.test.mjs +
tests/campaign-send-fail-closed.test.mjs, comms-empty-email-failclosed.test.mjs). No
template-failure mode reaches a provider. P0 disposition: NOT CONFIRMED (control present, tested).

---

### FSOS-070 — AI workforce orchestrator registered but NEVER scheduled (autonomous AI outreach never runs)
Severity: High
Subsystem: 7 (cron) / 5 (AI agents)
Status: PROVEN (in code) · execution NOT VERIFIED — LIVE REQUIRED

Observed:
`workforce-orchestrator` (and its alias `agent-runner`) are registered in the JOBS registry
(src/jobs/index.ts:42,46) and fully implemented (handlers.ts:358-366 → runWorkforce()), but
NEITHER path appears in vercel.json's 15 crons. No `.github/workflows` schedule, no pg_cron
entry, no other scheduler references it (full-repo grep). The daily AI workforce run — which
builds the prioritized outreach queue and dispatches every enabled outreach agent through the
gate — is therefore never invoked except by a manual authenticated GET.

Expected: docs/vercel-crons-restore.md:30 lists workforce-orchestrator at `0 15 * * *` in the
intended full set.

Root cause: PROVEN — config drift; handler exists, schedule dropped from vercel.json.

Blast radius: the entire autonomous AI outreach engine is dormant. Zero queue built, zero
agent sends occur automatically. Directly contradicts the "AI workforce" product surface.

Evidence: vercel.json:4-20 (absent); src/jobs/index.ts:42,46; src/jobs/handlers.ts:358-366;
docs/vercel-crons-restore.md:30.

Suggested fix direction (DO NOT IMPLEMENT): add the schedule to vercel.json (and confirm the
Vercel plan permits the cadence). Verify by observing a queue build + agent dispatch after a
scheduled fire.

Verification needed: LIVE — confirm Vercel invokes the path and runWorkforce builds a queue.

RESOLUTION (Phase 2 · Batch 1b) — RESOLVED — CODE/CONFIG VERIFIED (Vercel execution NOT VERIFIED — LIVE REQUIRED)
Base: branched from the Batch 1a branch HEAD (84f70d2 — Batch 1a not yet merged) so this work
inherits the FSOS-020 termination invariant; BATCH_1B_BASE_SHA = origin/main 512b163 (is-ancestor of HEAD).
Fix: scheduled `workforce-orchestrator` in vercel.json at `0 15 * * *`
(docs/vercel-crons-restore.md:30). It routes through the dynamic /api/cron/[job] dispatcher, which
recognizes the key (isJob) and 404s an unknown key (fail closed), wraps the run in
runIdempotent(job:hour-bucket), and requires the cron secret / x-vercel-cron header.

1a-INVARIANT (mandatory, separately tested): the workforce builds outreach_queue from detection
signals and dispatches ONLY through sendThroughGate. A reply-driven campaign termination (FSOS-020)
writes an individual BUSINESS suppression; that contact is now EXCLUDED at queue-BUILD time —
resolveRecipient() (src/lib/ai/workforce.ts) calls resolveEffectiveSuppression() (the SAME signal
the gate reads, fail-closed) and selectForQuota() drops it with reason 'business_suppressed'
(src/lib/ai/outreach.ts). The send gate remains the fail-closed authority at send time (blockedStep
'suppression'). Two independent layers → a reply-terminated contact can never be auto-contacted by
the workforce.

Idempotency/concurrency: buildQueue is idempotent by unique(queue_date,agent,entity);
runOutreachAgent atomically claims queued→drafted (single-winner); the route's hour-bucket
runIdempotent dedupes a same-window re-fire. Securities excluded at build + guarded again at dispatch.

Scope note: the workforce's referral_followup agent READS the `referrals` table as an outreach
signal (first-touch invitation) but does NOT read/write referral pipeline/SLA lifecycle state, so it
is not the deferred referral-lifecycle work; per-agent enablement is operator config
(agent_daily_targets, ships disabled until verified).

Files: vercel.json; src/lib/ai/workforce.ts; src/lib/ai/outreach.ts.
Tests: tests/cron-activation.test.mjs (dispatcher resolves the key + schedule present);
tests/workforce-suppression.test.mjs (selector drops a suppressed candidate); Scenario 9 in
tests/comms-inbound-e2e.test.mjs (real Postgres: a business-suppressed winback recipient is EXCLUDED
from outreach_queue; a clean recipient is queued; re-build is idempotent).
Independent review disposition: an adversarial review confirmed the detection set is clean, the
dispatcher fails closed, cadences are evidence-based, idempotency/concurrency hold, every send stays
behind sendThroughGate, and the deferral + out-of-scope boundaries are honored — and raised ONE
material finding (Medium): the `term_conversion` agent sends with purpose POLICY_DEADLINE, which is
TRANSACTIONAL, so the send gate's business-suppression step is SKIPPED for it — meaning the gate was
NOT a suppression backstop for that (enabled-by-default) agent, and the dispatch loop ignored
`rec.suppressed`. Fixed: added an agent-AGNOSTIC dispatch-time `rec.suppressed` guard in
runOutreachAgent (src/lib/ai/workforce.ts) that skips a suppressed row (block_reason
'business_suppressed') BEFORE drafting/sending, independent of the gate's purpose classification;
proven by the Scenario 9 dispatch assertion (a forced suppressed queue row is skipped with no draft
and no send). Two lower findings were informational/comment-accuracy: (LOW) scheduling the workforce
also activates referral first-touch OUTREACH via the referral_followup agent — accepted (signal read
only, no referral pipeline/SLA write; per-agent enablement is operator config, ships disabled) and
distinct from the deferred referral-lifecycle work; (LOW) overstated "gate re-checks regardless"
comments were corrected in workforce.ts/outreach.ts to describe the three real layers (build
exclusion + dispatch re-check + gate for non-transactional purposes).

NOT VERIFIED — LIVE REQUIRED: Vercel actually invoking the schedule; the Vercel plan permitting the
cron count/cadence; runWorkforce building a queue + dispatching against production data.
Status: RESOLVED — CODE/CONFIG VERIFIED.

---

### FSOS-071 — Six lifecycle-detection cron jobs registered but never scheduled (CRM automation dormant)
Severity: High
Subsystem: 7 (cron)
Status: PROVEN (in code) · execution NOT VERIFIED — LIVE REQUIRED

Observed:
`conversion-watch`, `xdate-watch`, `referral-sla`, `agency-dormancy`, `cross-sell-scan`,
`commission-reconcile` are real handlers (handlers.ts:36,52,68,82,97,114) registered in
index.ts:31-36 but absent from vercel.json. Only `renewal-watch` and `data-quality` of the
detection set are scheduled.

Blast radius: no term-conversion identification, no competitor x-date outreach windows,
**no referral-SLA-breach escalations to the FSA**, no agency-dormancy flagging, no cross-sell
gap scan, no commission reconciliation. These feed tasks/escalations a human then works; their
absence is SILENT (no error — the jobs simply never run). referral-SLA in particular is a
launch-relevant partnership-operations gap.

Root cause: PROVEN — vercel.json was rebuilt around the newer campaign-engine crons and
dropped the detection jobs (docs/vercel-crons-restore.md:24-28 shows they were intended).

Evidence: src/jobs/handlers.ts:36-131; src/jobs/index.ts:31-36; vercel.json (absent);
docs/vercel-crons-restore.md:24-28.

Suggested fix direction (DO NOT IMPLEMENT): restore the detection crons to vercel.json.
Verification: LIVE — observe each job creating its tasks/escalations on schedule.

RESOLUTION (Phase 2 · Batch 1b) — PARTIAL: 5 of 6 ACTIVATED (CODE/CONFIG VERIFIED); referral-SLA DEFERRED
Activated (referral-INDEPENDENT) in vercel.json, cadences from docs/vercel-crons-restore.md:24-30:
- conversion-watch      `0 9 * * *`   — activities: conversion_identify; securities excluded; NO send
- xdate-watch           `0 9 * * *`   — work_tasks; NO send
- cross-sell-scan       `30 9 * * *`  — activities: crosssell_identify; invitation-only; NO send
- agency-dormancy       `0 10 * * *`  — agency_partnerships status + reactivation work_task; NO send
- commission-reconcile  `0 11 * * *`  — commission reconciliation_status transition; NO send
Each resolves via the [job] dispatcher (isJob → an unknown key 404s), is wrapped in
runIdempotent(job:hour-bucket), and is additionally idempotent by its own existence/state guard
(work_task/activity 'exists' check; status-transition-only). NONE reads or writes any campaign
enrollment table and NONE sends a client-facing message — so none can re-select, advance, or
re-enroll a reply-terminated enrollment (no enrollment touch at all; verified: no DB trigger
auto-enrolls from `activities`). The 1a invariant holds trivially for the detection set.

DEFERRED — REFERRAL-LIFECYCLE DECISION PENDING: `referral-sla` (handlers.ts:82) reads
v_referrals_awaiting_action (referral pipeline/SLA lifecycle state) → REFERRAL-DEPENDENT → NOT
scheduled this batch (asserted in tests/cron-activation.test.mjs). It becomes a later batch once the
referral pipeline-stage-placement vs. human-worked-artifact product decision is made.

Files: vercel.json. Tests: tests/cron-activation.test.mjs (all 5 scheduled + dispatcher-resolved;
referral-sla asserted NOT scheduled).
NOT VERIFIED — LIVE REQUIRED: Vercel invoking each schedule; each job creating its
tasks/activities/escalations on cadence against production data.
Status: PARTIAL — 5 ACTIVATED (CODE/CONFIG VERIFIED) · referral-SLA DEFERRED.

---

### FSOS-072 — workshop-reminders dedicated cron route exists but is unscheduled
Severity: Medium
Subsystem: 7
Status: PROVEN (in code) · execution NOT VERIFIED — LIVE REQUIRED

Observed: src/app/api/cron/workshop-reminders/route.ts is a complete route (runReminderPass +
runNurturePass, correct auth, per-(reg,channel,kind) idempotency via workshop_message_log) but
no vercel.json entry invokes it. Intended `*/15 * * * *` (docs/vercel-crons-restore.md:33).

Blast radius: workshop pre-event reminders + post-event nurture never send automatically;
time-of-day-sensitive so a manual daily poke cannot recover them.

Evidence: src/app/api/cron/workshop-reminders/route.ts; vercel.json (absent).

Suggested fix direction: schedule it. DO NOT IMPLEMENT.

---

### FSOS-073 — backup-verify DR heartbeat never scheduled
Severity: Medium
Subsystem: 7
Status: PROVEN (in code) · execution NOT VERIFIED — LIVE REQUIRED

Observed: `backup-verify` (handlers.ts:478-484) writes a DR restore-test heartbeat to the audit
log/activities, registered (index.ts:69), absent from vercel.json. Intended `0 3 * * *`.
Blast radius: no automated backup-verification signal is recorded; monitoring keyed on its
presence would never see it (or alarm forever). The actual pg_dump is external; only the
observability heartbeat is dead.
Evidence: src/jobs/handlers.ts:478-484; vercel.json (absent).
Suggested fix direction: schedule it (and confirm the external backup it attests to exists).

---

### FSOS-074 — Cron restore runbook is stale and would cause a DESTRUCTIVE "recovery"
Severity: Medium (operational-trust)
Subsystem: 7 (docs/ops)
Status: PROVEN

Observed: docs/vercel-crons-restore.md:7-13 claims vercel.json is "trimmed to 2 daily crons",
but the live vercel.json has 15 (incl. `*/5`, `*/15`, `30 * * * *`). The doc's "restore to Pro"
list (:21-34) is a THIRD, different 12-cron set that contains the FSOS-070..073 orphans but
OMITS every live campaign-engine tick/retry. An operator following it to "restore all crons"
would DROP the 12 live campaign crons and add the 6 detection jobs — a misleading, destructive
recovery. Three inconsistent pictures: doc-current (2), doc-restore (12), reality (15).
Evidence: docs/vercel-crons-restore.md:7-13,21-34 vs vercel.json:4-20.
Suggested fix direction: reconcile the runbook to reality after FSOS-070/071 are triaged.

---

### FSOS-075 — Second, ungoverned scheduler: legacy pg_cron nightly scoring on legacy tables
Severity: Low (informational)
Subsystem: 7
Status: PROVEN (in migration) · execution NOT VERIFIED — LIVE REQUIRED

Observed: supabase/migrations/001_initial_schema.sql schedules
`cron.schedule('fsos-nightly-scoring','0 8 * * *','select run_nightly_scoring();')` via pg_cron
(extension enabled in the same migration), operating on legacy `customers`/`scores` tables —
entirely outside the Node JOBS registry, the `[job]` dispatcher, kill switches, and the audit
path. Invisible to the vercel.json inventory.
Blast radius: an ungoverned DB-side scheduled job; if the legacy customers/scores model is
superseded by the household/agency spine it may be scoring dead data nightly, and no
app-layer control can pause it.
Evidence: supabase/migrations/001_initial_schema.sql (pg_cron enable + cron.schedule ~:884-891).
Verification needed: LIVE — is pg_cron enabled in the live project and does run_nightly_scoring
still touch live data?

---

### FSOS-076 — Cron idempotency & concurrency design is SOUND (no defect; recorded)
Severity: Informational
Subsystem: 7
Status: PROVEN

Observed:
- The `[job]` dispatcher authorizes via `x-vercel-cron` OR `Authorization: Bearer <cronSecret>`
  and 404s unknown jobs (cron/[job]/route.ts:14-31). Dedicated routes (booking-reminders,
  social-publish, workshop-reminders) authorize the same way.
- Dedupe is by UTC HOUR bucket `${job}:${YYYY-MM-DDTHH}` (route.ts:40) + dead-lease reclaim
  (runtime.ts, JOB_LEASE_MS=15m). NOTE: the handlers.ts:3 header comment still says "job:date"
  — stale comment; the code is hour-granular. A thrown handler releases the claim (retryable);
  all handlers return ok:true so no false "completed" skip is reachable.
- tick vs retry: separate job names → separate buckets (must both run). They touch the same
  `*_executions` table but disjoint rows — tick inserts/sends new touches (guarded by the unique
  constraints), retry only updates rows already `status='scheduled'` past `next_retry_at` and
  never advances the enrollment cursor. No advance-race reachable.
Residual (expected, not a bug): the hour-bucket caps any [job] cron at one successful run per
clock hour, so a manual re-trigger in the same hour after success returns `skipped:true`.

Evidence: src/app/api/cron/[job]/route.ts:14-52; src/lib/jobs/runtime.ts; migrations 081:113,134 / 089:35.

---

### FSOS-060 — API mutations do NOT enforce MFA / step-up (middleware excludes /api/)
Severity: High
Subsystem: 6 (Auth/RLS)
Status: PROVEN

Observed (independently verified by the lead):
MFA/step-up (aal2) is enforced ONLY in middleware, and the middleware matcher explicitly
EXCLUDES `api/` (src/middleware.ts:20-23 — `...api/|...` in the negative lookahead). MFA is
computed and applied only inside middleware (`mfaSatisfied = aal==='aal2'`, middleware.ts:
64-71 → evaluateAccess). The API authorization primitive `requireApiRole` checks ONLY
authentication + role intersection and never inspects MFA/step-up (src/lib/auth/api.ts:22-31);
`getServerSession` computes `mfaSatisfied`/`stepUpFresh` but no API route reads them (grep:
zero references to mfaSatisfied/stepUpFresh/mandatory_stepup under src/app/api).

Consequence: a password-only (aal1) session bearing the right role claim can drive EVERY
privileged API mutation — including `POST /api/super/users` (create admin/super_admin),
and all `/api/super/*`, `/api/compliance/*`, `/api/admin/*` mutations — bypassing the
second-factor/step-up requirement the RBAC matrix declares (rbac.ts: fsa/admin/compliance
`mfa:'required'`, super `mandatory_stepup`) and that the UI/middleware enforces for pages.

Expected: an API call to an MFA-gated portal should require the same aal2/step-up as the UI.

Root cause: PROVEN — enforcement-layer gap; MFA is a middleware/page concern only, and
middleware does not run for the API surface.

Blast radius: all mutating APIs across the four MFA-gated portals; worst case privilege
escalation via `/api/super/users`.

Evidence: src/middleware.ts:20-23,64-71; src/lib/auth/api.ts:22-31; src/lib/auth/session.ts
(mfaSatisfied computed, unused by API); src/app/api/super/users/route.ts:16-19.

Suggested fix direction (DO NOT IMPLEMENT): have requireApiRole (or a wrapper) enforce the
portal's declared MFA/step-up level from the session claims. Verify with a test: an aal1
session is 403'd on a mandatory_stepup route.

Verification needed: unit/integration — aal1 session blocked on /api/super/* mutations.

---

### FSOS-061 — Entire API runs as service role; RLS is NOT a backstop for API traffic (systemic)
Severity: High (systemic)
Subsystem: 6
Status: PROVEN

Observed:
All ~180 data-touching API routes use `getDb()` — the SERVICE-ROLE Supabase client, which
bypasses RLS by construction (src/lib/supabase/client.ts:34-54, comment ~:31). The
RLS-respecting `getBrowserDb()` (anon) exists (client.ts:64) but is NEVER used anywhere; the
SSR client is used only for `auth.getUser()` identity, never for domain queries. So NO
application path reads/writes FSOS data under an RLS-scoped role.

Consequence: on live API traffic RLS catches nothing — every authorization guarantee rests
SOLELY on the app-layer `requireApiRole`/`requirePermission` calls. Any route that omits a
check has NO backstop. The in-code comments claiming "RLS remains the primary row guarantee"
(api.ts:6-7, session.ts) are inaccurate for the API surface. This AMPLIFIES FSOS-060/062/063
and the structural IDOR risk (FSOS-064).

Expected: defense-in-depth — RLS should still constrain a route that forgets an app check.

Root cause: PROVEN — service-role-everywhere architecture with no RLS-scoped data path.

Blast radius: systemic. Not itself an exploit, but it removes the safety net auditors assume.
The RLS suite (which passes) validates the `authenticated`/client role path — NOT the
service_role path the API actually uses (see FSOS-065).

Evidence: src/lib/supabase/client.ts:31,34-54,64; src/lib/auth/api.ts:6-7; grep: getBrowserDb
unused, getDb used by ~180 routes.

Suggested fix direction (DO NOT IMPLEMENT): route tenant-scoped reads through an RLS-respecting
client, OR document explicitly that app-layer checks are the sole control and add a CI guard
that every non-public mutation route calls an auth helper. DO NOT weaken any control.

Verification needed: CI lint asserting every non-public route calls requireApiRole/
requireInternalAuth; consider an RLS-scoped read path for partner/client surfaces.

---

### FSOS-062 — agencies/upload: fully public, unauthenticated, service-role writes
Severity: Medium
Subsystem: 6
Status: PROVEN

Observed: `POST /api/agencies/upload` has NO auth call (no requireApiRole/requireInternalAuth/
session) (src/app/api/agencies/upload/route.ts:14). It resolves an agency by `slug` (:40-44),
then creates `customers` (:62-73), uploads to storage (:86-91), and inserts agency_uploads/
activity (:111,:121) — all via the service-role getDb(). Only file size/ext are bounded
(:30-38); no rate limit, CAPTCHA, or consent. It sits OUTSIDE the `/api/public/**` group
despite being public-by-intent (so it lacks that group's abuse controls).

Blast radius: anonymous data injection — arbitrary `customers` creation + storage/activity
pollution for any enumerable agency slug. Not exfiltration (signed URLs are returned only for
the just-uploaded file, :102-105).

Root cause: PROVEN — missing input-boundary throttling on an intentionally public write,
mounted outside the hardened public group.

Evidence: src/app/api/agencies/upload/route.ts:14,30-91,102-121.

Suggested fix direction (DO NOT IMPLEMENT): rate-limit + relocate under /api/public/** with
the same honeypot/limit controls the other public writes use.

---

### FSOS-063 — 28 internal-auth shared-secret routes: parallel authz, weak attribution, legacy user features
Severity: Medium
Subsystem: 6
Status: PROVEN (mechanism) · exposure HYPOTHESIS

Observed: 28 routes gate ONLY on `requireInternalAuth` (Bearer $FSOS_API_SECRET or HTTP Basic
$FSOS_ADMIN_USER/PASSWORD; fails closed unconfigured — http.ts:121-150, config-gate.ts:28-32).
These carry no Supabase RBAC; audit actor collapses to 'api'/'internal'/basic-username
(http.ts:153-166). Some are legitimately server-to-server (customers/upsert = APEX webhook;
campaigns/run = cron). Others look like LEGACY user features with a modern RBAC-gated twin —
`/api/tasks`, `/api/gdc/cases`, `/api/opra` vs `/api/work-tasks` (requireApiRole('fsa'));
grep found no browser callers of tasks/gdc/opra. The http.ts:112-114 comment claiming "the
browser replays Basic credentials" is STALE (middleware now uses Supabase sessions).

Blast radius: one shared credential (if FSOS_ADMIN_PASSWORD is set) invokes all 28 — including
comms-run and data upsert — outside RBAC/MFA, with degraded audit identity.

Root cause: PROVEN — legacy parallel auth path not retired after RBAC landed.

Evidence: src/lib/http.ts:112-166; src/app/api/{tasks,gdc/cases,opra,campaigns/run,
customers/upsert}/route.ts; twin /api/work-tasks/route.ts.

Suggested fix direction (DO NOT IMPLEMENT): retire legacy internal-auth user routes in favor
of RBAC twins, or confirm server-only and fix the stale comment.

Verification needed: LIVE — confirm no browser path invokes the legacy internal-auth routes.

---

### FSOS-064 — Object-level authorization relies on shared-book model; structural IDOR risk (no backstop)
Severity: Low (currently safe) / structural
Subsystem: 6
Status: PROVEN

Observed: representative [id] routes (households/[id], agencies/[id], cases/[id], contacts/[id],
opportunities/[id]/stage, referrals/[id]) gate by requireApiRole('fsa') + requirePermission,
then load/update by id with NO per-record ownership check — CORRECT for a single-practice FSA
portal where staff share the whole book. Partner/client routes derive tenant scope from the
SESSION (agencyIdsFor/householdIdFor — partner/refer/route.ts:26-28, client/consent/route.ts:
30-31) and never trust a client-supplied id → no IDOR today; the assertAgencyScope/
assertHouseholdScope helpers (session.ts:98-119) are unused dead code.

Structural risk: because RLS is bypassed (FSOS-061), the day any partner/client [id] route
trusts a request-supplied id, it becomes a straight IDOR with zero backstop.

Root cause: PROVEN — no ownership enforcement + no RLS backstop; safe only by the shared-book
assumption and session-derived scoping.

Evidence: src/app/api/households/[id]/route.ts:25-59; agencies/[id]/route.ts:32-91;
partner/refer/route.ts:26-28; client/consent/route.ts:30-31; session.ts:98-119 (unused).

Suggested fix direction (DO NOT IMPLEMENT): add a lint/convention guard; wire the assert*
helpers on partner/client id routes before any multi-tenant expansion.

---

### FSOS-065 — RLS suite is thorough but proves only the role the API never uses
Severity: Low (informational, qualifies baseline)
Subsystem: 6
Status: PROVEN

Observed: tests/rls-firewall.test.mjs is comprehensive — it proves (as `authenticated`/client
role via `set role authenticated`) the is_security firewall row/column rule, cross-household
scope, security_invoker view non-leak (:346-363), back-office default-deny (~15 tables), FNA/
social append-only immutability, and exactly-once publish claims. But it runs as
`postgres`/`authenticated`, NEVER as `service_role` — the ONLY role the API uses (FSOS-061).
So a green RLS suite says nothing about whether an API route enforced its role check. The suite
also SKIPs cleanly without local Postgres unless CI_REQUIRE_INFRA=1 (:34-45) — LIVE REQUIRED to
confirm CI actually sets that flag (else the proof can silently skip).

Evidence: tests/rls-firewall.test.mjs:34-45,335-445.

Verification needed: confirm CI sets CI_REQUIRE_INFRA=1; add service-role-path authz tests.

---

### FSOS-040 — Booking double-booking, timezone, reschedule, cancellation, reminders are SOLID (recorded)
Severity: Informational (controls verified in code)
Subsystem: 4
Status: PROVEN (code) · DB-constraint enforcement in prod NOT VERIFIED — LIVE REQUIRED

Observed:
- Concurrent double-booking is DB-enforced, layered: partial unique index
  `uq_appointments_host_slot(host_user_id, starts_at) WHERE status='scheduled'`
  (mig 069), GiST exclusion `excl_appointments_host_overlap` on host + tstzrange (mig 091),
  null-host analogs (mig 119). The insert relies on these, not read-then-write, translating
  23505/23P01 into a clean "just taken" (src/lib/booking/book.ts:150-175, insert-errors.ts:29-32).
- Timezone/DST math is Intl-backed and correct by construction (booking/timezone.ts:36-50;
  availability.ts:218-258).
- Reschedule is a REAL datetime move (UPDATE starts_at/ends_at/scheduled_at, status-guarded,
  bumps schedule_version) — not a status-only transition (booking/manage.ts:158-177).
- Cancellation persists via a state-machine-validated, TOCTOU-guarded conditional UPDATE +
  append-only audit (appointments/service.ts:35-103; manage.ts:88-116).
- Reminders are durable + idempotent via UNIQUE(appointment_id, schedule_version, event,
  offset_minutes, channel) atomic upsert (booking/notify.ts:167-189, mig 093); cron
  `*/15 * * * *`, secret-authed; does not depend on an open session.
- Auth boundaries correct: public routes rate-limited/honeypot/Zod; manage mutations gated by
  HMAC-signed expiring single-purpose tokens that FAIL CLOSED when no key is set and expose no
  DB id (booking/manage-tokens.ts:32-73); FSA routes requireApiRole('fsa')+requirePermission;
  OAuth callback double-binds signed CSRF state to an httpOnly nonce cookie.

Caveat (LIVE REQUIRED): all DB-constraint guarantees assume migrations 069/091/119 are APPLIED
in prod; the code documents a history of prod migration lag (insert-errors.ts:6-14, ADR-039).
If any is unapplied, that concurrency guard silently does not exist and booking falls back to
an app-layer read-then-write TOCTOU window. Cannot be confirmed statically.

Evidence: supabase/migrations/{069,091,119,093}_*.sql; src/lib/booking/{book,manage,timezone,
availability,notify,manage-tokens,insert-errors}.ts; src/lib/appointments/service.ts:35-103.

---

### FSOS-041 — Reschedule race surfaces an opaque 500 on overlap (not exact-start) collisions
Severity: Low
Subsystem: 4
Status: PROVEN

Observed: `rescheduleAppointment` handles only Postgres `23505` (unique_violation)
(booking/manage.ts:122,178-183). A concurrent claim that OVERLAPS but does not share an
identical start trips the GiST exclusion `23P01` (mig 091/119), which falls through to the
generic branch → HTTP 500 "Could not reschedule." The INSERT path already treats both codes as
"just taken" via isSlotCollision (insert-errors.ts:29-32); reschedule does not reuse it.

Blast radius: public + FSA reschedule. No data corruption (the DB still prevents the
double-book); only the surfaced error is wrong (500 vs a clean 409 "pick another time").
Race-only.

Root cause: PROVEN — inconsistent collision classification between book.ts (23505+23P01) and
manage.ts reschedule (23505 only).

Evidence: src/lib/booking/manage.ts:122,178-183; src/lib/booking/insert-errors.ts:29-32.

Suggested fix direction (DO NOT IMPLEMENT): reuse isSlotCollision in the reschedule catch.

---

### FSOS-042 — Same-day reschedule counts the appointment against itself (capacity/buffer self-block)
Severity: Medium
Subsystem: 4
Status: PROVEN (root cause) · user-visible impact HYPOTHESIS (config-dependent)

Observed: reschedule re-validates the new slot with computeSlotsForType (manage.ts:145-154)
while the appointment's OWN row is still status='scheduled'. The busy query selects all
scheduled appointments for the host with NO `id` exclusion (booking/slots.ts:77-83), so the
row being moved is counted in existingAppointments. Consequences: (a) a type with max_per_day
at capacity counting this appointment wrongly rejects a same-day move as unavailable
(availability.ts:204-210,253-256); (b) moving within buffer_before/after distance of the
current slot is blocked by the appointment's own buffer expansion (availability.ts:194-197,249).

Blast radius: any reschedule where the type has a per-day cap or non-zero buffers and the new
slot is same-day/near the old. max_per_day defaults null (unlimited) → (a) affects capped
types only; (b) affects any type with buffers>0. Legitimate moves silently unavailable; not a
data-integrity issue.

Root cause: PROVEN — no self-exclusion of appt.id in the reschedule availability recompute.

Evidence: src/lib/booking/manage.ts:145-154; src/lib/booking/slots.ts:77-83;
src/lib/booking/availability.ts:194-210,249,253-256.

Suggested fix direction (DO NOT IMPLEMENT): exclude the appointment's own id from the busy/
capacity sets during its reschedule re-validation.

---

### FSOS-043 — Calendar integration: Google event PUSH is ABSENT (read-only freeBusy); Zoom reachable but LIVE-unverified
Severity: Low (scope clarification) / Informational
Subsystem: 4
Status: PROVEN (absence) · Zoom/freeBusy runtime NOT VERIFIED — LIVE REQUIRED

Observed:
- Google Calendar EVENT PUSH (write) does NOT exist — no events.insert/update/delete anywhere;
  the only Google endpoint is freeBusy READ (booking/google/oauth.ts:30; busy.ts enforces
  one-way read-only). So a booking pushes NO event to the FSA's Google Calendar. Classify: not
  present (not merely config-only).
- Google freeBusy READ import is CODE VERIFIED reachable (slots.ts:88-93,129 → loadGoogleBusy →
  fetchFreeBusy, exchange.ts:148), degrade-safe on failure; real busy-block return is LIVE
  REQUIRED (needs connected account).
- Zoom provisioning (create/update/delete) is CODE VERIFIED reachable (zoom/client.ts:140,207,
  234; reached from book.ts:186-208, manage.ts:104-109,187-195), credential-gated no-op when
  ZOOM_* absent (join_url left null for retry, booking never blocked). Actual meeting creation
  is LIVE REQUIRED (needs Zoom S2S creds).

Blast radius: if two-way calendar sync is expected, the FSA's own calendar shows no FSOS
appointment (only the FSOS DB + freeBusy read). A product/scope decision, not a code defect.

Evidence: src/lib/booking/google/{oauth.ts:30,busy.ts,exchange.ts:148}; src/lib/booking/
slots.ts:88-93,129; src/lib/zoom/client.ts:140,207,234; book.ts:186-208; manage.ts:104-109,187-195.

Verification needed: LIVE — connected Google account returns busy blocks; Zoom creds create a
meeting. Confirm whether outbound event-push to the FSA calendar is in product scope.

---

### FSOS-030 — Message-of-record FK reconciliation: model SOUND; orphan when provider_id is null/not-yet-patched (KNOWN P0: PARTIALLY PROVEN)
Severity: Medium
Subsystem: 3 (Webhooks)
Status: PARTIALLY PROVEN

Observed:
The outbound→provider→callback→reconciliation chain is fundamentally sound, with two of the
P0's four failure modes STRUCTURALLY PREVENTED and one real residual gap:
- Correlation is by `provider_id` via `findMessageByProviderId` → `.maybeSingle()`
  (events.ts:163-181). `uq_comm_messages_provider_id` is a PARTIAL UNIQUE index WHERE
  provider_id IS NOT NULL (mig 079:19) → provider_id is globally unique when set, so a
  callback can NEVER correlate to the WRONG message and maybeSingle can never see two rows.
  "Ambiguous after retries/duplicate sends" is prevented: a retry gets a NEW provider_id
  (new comm_messages row); the unique index blocks any collision.
- Callbacks advance ONLY the comm_messages lifecycle (delivered_at/failed_at/delivery_status),
  NEVER campaign/enrollment state (twilio/status/route.ts:29-44, resend/route.ts:59-65 →
  recordMessageEvent). Campaign advancement is driven by the tick engines off execution rows,
  not delivery callbacks. So a callback CANNOT "incorrectly advance campaign state" — the two
  are decoupled. (This answers the P0's sharpest concern in the negative.)
- Out-of-order handling: reconcileLifecycle prevents a late `sent` from downgrading a terminal
  status and preserves a gate `blocked` status against a spurious provider patch
  (events.ts:98-111). Unit-tested (tests/comms-message-status.test.mjs).

RESIDUAL GAP (the P0's "fail to correlate / orphaned state"): the outbound row's `provider_id`
is patched onto comm_messages AFTER dispatch returns (send.ts:1144-1165). If a provider status
callback arrives BEFORE that patch (fast queued/sent callbacks), OR the send never captured a
provider id (result.providerId undefined → provider_id stays null), then
findMessageByProviderId returns null → recordMessageEvent runs with `messageId: null` → the
`if (input.messageId)` lifecycle-advance block is SKIPPED (events.ts:141-159). The event is
appended to the ledger orphaned (message_id null) and the parent message's delivery_status is
NEVER advanced. A row whose provider_id was never captured stays 'sent'/'queued' forever
(permanent orphan); the transient early-callback case self-heals when a later terminal callback
arrives after the patch.

Expected: a provider callback should reliably reconcile to its message; a never-captured
provider id should be observable (not a silent permanent orphan).

Root cause: PROVEN — provider_id correlation key is written after the send returns, and the
event recorder no-ops the lifecycle advance when correlation fails, with no retry/repair path
for orphaned status events.

Blast radius: SMS/email delivery status accuracy on the comms surfaces + any consumer keyed on
delivery_status; bounded because terminal callbacks reconcile once the row is patched, and
campaign state is unaffected. Worst case: messages whose provider id was never captured show a
stuck lifecycle and never record delivered/failed.

Evidence: src/lib/comms/send.ts:1141-1165; src/lib/comms/events.ts:124-181;
src/app/api/webhooks/twilio/status/route.ts:25-44; src/app/api/webhooks/resend/route.ts:59-65;
supabase/migrations/079_comm_messages_provider_dedupe.sql:10-19.

Suggested fix direction (DO NOT IMPLEMENT): buffer/replay status events that arrive before the
provider_id patch (or correlate by a pre-issued idempotency key set BEFORE dispatch); surface
never-correlated status events for repair. DO NOT IMPLEMENT.

Verification needed: test — a status callback for an uncorrelated/lagging provider_id must not
silently drop the lifecycle update; confirm no message is left permanently at 'sent'.

---

### FSOS-031 — Webhook signature verification & STOP propagation are SOLID (recorded)
Severity: Informational (controls verified)
Subsystem: 3
Status: PROVEN

Observed:
- All comms webhooks verify signatures and fail closed: Twilio inbound
  (webhooks/twilio/inbound/route.ts:24) + status (:21) via verifyTwilioSignature (401 on
  mismatch), Resend (webhooks/resend/route.ts:47), email-inbound (secret-or-Svix; dev-only
  open, prod closed — :21-31,55), Zoom (HMAC + CRC + timestamp tolerance — :45-62). GHL also
  HMAC + timingSafeEqual fail-closed (but see FSOS-001 — that receiver should not exist).
- Idempotency on INBOUND: processInbound pre-checks provider_id and short-circuits a duplicate,
  backed by uq_comm_messages_provider_id (inbound.ts:239-259, mig 079). No duplicate
  conversation message or second AI auto-reply on a provider retry.
- STOP propagation is immediate + durable: an inbound STOP revokes member consent, cascades
  purpose-scoped revokes, adds a DNC entry, and TERMINATES live enrollments (opted_out/exited/
  suppressed, never resumed) before returning (inbound.ts:53-90,148-189,301-322). The send-time
  gate independently re-checks DNC + consent (send.ts onDNC/hasConsent, gate.ts steps 1/3), so
  a suppressed recipient is blocked at the next send even if a race left an enrollment row live.

Evidence: src/app/api/webhooks/{twilio/inbound,twilio/status,resend,email/inbound,zoom}/route.ts;
src/lib/comms/inbound.ts:53-90,148-189,239-322; supabase/migrations/079_comm_messages_provider_dedupe.sql.

Note: STOP is exact-first-word-keyword-only — natural-language opt-outs do NOT propagate here
(see FSOS-020, the reply-exit P0).

---

### FSOS-032 — Status/event ledger has no idempotency key; duplicate provider callbacks append duplicate rows
Severity: Low
Subsystem: 3
Status: PROVEN

Observed: `comm_message_events` has only plain indexes, NO unique constraint
(mig 033:96-110), and recordMessageEvent inserts unconditionally with no dedupe
(events.ts:124-139). Providers deliver at-least-once, so a repeated delivered/opened/clicked
callback appends duplicate ledger rows. Impact is bounded because delivery RATES are read from
the parent comm_messages row's reconciled delivery_status/opened_at/clicked_at (idempotent — a
repeated terminal event just re-sets the same timestamp), so the primary defect is duplicate
entries in the per-message TIMELINE view (cosmetic) rather than inflated aggregate rates.

Evidence: supabase/migrations/033_comms_inbound_knowledge_campaigns.sql:96-110;
src/lib/comms/events.ts:124-139; consumers: timeline.ts, timeline-load.ts, tracking.ts.

Suggested fix direction (DO NOT IMPLEMENT): a unique key on (message_id, event, provider_id)
or an event fingerprint would make the ledger idempotent. Confirm no rate metric counts raw
event rows before deprioritizing.

---

### FSOS-050 — AI agent roster overstates the live surface: several agents have NO reachable execution path
Severity: Medium
Subsystem: 5 (AI agents)
Status: PROVEN (no execution path) / HYPOTHESIS (intended behavior)

Observed:
The AGENT_ROSTER (src/lib/ai/roster.ts:41-69) declares 19 agents with missions/tools/triggers,
rendered in the AI Operations detail UI as the agent workforce. Cross-referencing every roster
key against executable code (src/lib, src/jobs, src/app/api, excluding roster.ts + UI):
- REAL execution path traced: `conversation` (responder, inbound webhooks),
  `contact_router` (contact upload), `content_drafter` + `engagement_triager` (social
  automation/drafter), `data_quality` (scheduled job), `marketing_automation` (campaign ticks +
  campaign-dispatch), and the four OUTREACH agents `cross_sell`/`term_conversion`/
  `referral_followup`/`life_winback` (workforce runOutreachAgent). `compliance_guardrail` is
  real as the gate/validator (not a runAgent). 
- NO reachable execution path found (refs=0 outside roster/UI, or referenced only as a routing
  LABEL, never invoked as an agent): `agency_growth`, `case_management`,
  `document_intelligence` (all refs=0 in lib/jobs/api); `commission_reconciliation`
  (a detection HANDLER exists but is unscheduled — FSOS-071 — and no runAgent invokes the
  agent); `executive_intelligence`, `agency_activation`, `referral_triage` (referenced only as
  contactRouter routing labels / UI, never run as agents); `pipeline` (used only as a
  conversation-thread AUTHOR key + campaign naming — its roster mission "flag stalled
  opportunities on a stage-age threshold" has no wired trigger).

So the AI Operations roster presents ~7–9 agents as operational that have no runtime path at
HEAD, and the four proactive OUTREACH agents that ARE engine-complete are DORMANT because their
dispatcher (workforce-orchestrator) and detection feeders (cross-sell-scan / conversion-watch /
referral-sla) are unscheduled (FSOS-070, FSOS-071). `runAgent` has exactly ONE caller in the
codebase (workforce.ts:361).

Expected: an agent shown as active in the AI Operations UI should have a reachable execution
path, or be clearly labeled roadmap/not-yet-wired.

Root cause: PROVEN (no code path) — roster metadata was authored ahead of (or decoupled from)
the runtime wiring; HYPOTHESIS on which are intended-live vs roadmap.

Blast radius: operator trust / observability — the FSA sees a workforce that is largely not
running. Combined with FSOS-070/071 (dormant crons) the AUTONOMOUS AI outreach story is
effectively off at HEAD, while the UI implies it is on.

Evidence: src/lib/ai/roster.ts:41-69; src/lib/ai/workforce.ts:361 (sole runAgent caller);
src/lib/ai/outreach.ts:22-27 (OUTREACH_AGENTS = 4); per-key reference scan (refs=0 for
agency_growth/case_management/document_intelligence/commission_reconciliation-as-agent).
Cross-ref FSOS-070, FSOS-071.

Suggested fix direction (DO NOT IMPLEMENT): either wire the missing agents' triggers or mark
them roadmap in the roster/UI; schedule the workforce + detection crons so the wired agents run.

Verification needed: confirm each roster agent's trigger reaches a runAgent (or is labeled
not-live); LIVE — observe the workforce building a queue once scheduled.

---

### FSOS-051 — AI agent governance & escalation are SOLID where the engine runs (recorded)
Severity: Informational (controls verified)
Subsystem: 5
Status: PROVEN (CODE VERIFIED)

Observed (workforce runOutreachAgent — src/lib/ai/workforce.ts):
- Every client-facing AI send routes through `sendThroughGate` with `aiGenerated:true`,
  `aiAuthorAgentKey` (per-agent kill switch satisfies gate step 4 only when the global gateway
  AND that agent are enabled), `purpose`, and an AI message class — so consent/quiet-hours/DNC/
  recommendation/securities are all enforced, and an unclassified send fails safe to draft_only
  (workforce.ts:442-461; send.ts hasApprovedAiPolicy:427-440, evaluateOutboundMessage:1084-1139).
- Double-send guard: atomic queue claim (queued→drafted, one winner) before drafting
  (workforce.ts:372-379); per-agent daily quota; hours-of-operation pre-check
  (workforce.ts:334-356).
- Securities firewall + unknown-source + recommendation-language are escalated (not sent)
  before the gate (workforce.ts:384-433). Blocked-at-gate items are marked + counted, never
  silently dropped (workforce.ts:463-472).
- Confidence is set on the run (ctx.setConfidence 0.9) and per-agent confidenceThreshold lives
  in the roster; escalation writes to agent_actions via ctx.escalate. Green-zone tool vocabulary
  has no recommend/advise/allocate tool anywhere (roster.ts:14-31, assertGreenZoneOnly:72-76).
- Inbound AI auto-reply (responder → tryAutoReply) is turn-limited (fail-closed hand-off),
  securities-excluded, classified fail-closed, and gated (inbound.ts:346-478; reply-
  classification.ts). All verified in subsystem 1/2.

Evidence: src/lib/ai/workforce.ts:329-478; src/lib/ai/roster.ts:14-76; src/lib/comms/send.ts:
427-440,1084-1139; src/lib/comms/inbound.ts:385-478.

Note: this governance is correct but LARGELY DORMANT at HEAD (FSOS-070/071) — the engine is
sound; it just is not being triggered on a schedule.

---
---

# PHASE 2 — FINAL REPAIR & PRODUCTION-HARDENING BATCH

Base: cc08177 (Batch 1b) · branch: claude/fsos-phase-2-final · ancestors verified:
84f70d2 (Batch 1a), 512b163 (origin/main). This section APPENDS resolution evidence for every
still-open Phase-1 finding; it does not rewrite Phase-1 history above. Each finding is reconciled
to exactly one of: RESOLVED — CODE VERIFIED · VERIFIED — NO REPAIR REQUIRED · PARTIALLY RESOLVED ·
DEFERRED — BUSINESS DECISION REQUIRED · NOT VERIFIED — LIVE REQUIRED.

## FSOS-030 — Message-of-record reconciliation — RESOLVED — CODE VERIFIED
Root cause (proven): the correlation key (provider_id) was written to comm_messages AFTER the
irreversible provider send returned (send.ts, post-dispatch patch), so a status callback arriving
before that patch — or a send that never captured a provider_id — orphaned the lifecycle update.
Wrong-message correlation was already impossible (uq_comm_messages_provider_id, mig 079) and
campaign state does not advance off delivery callbacks; the gap was purely the orphan window.
Fix: echo the comm_messages id (which exists BEFORE dispatch) to the provider as a deterministic
callback key — Twilio `StatusCallback ?mid=`, Resend `X-FSOS-Message-Id` header — and correlate on
it FIRST (findMessageById), falling back to provider_id; when neither resolves, FAIL CLOSED without
guessing but log it OBSERVABLE (console.error) and still append the event orphaned (never dropped).
Invariants held: no wrong-message update; duplicate callback idempotent (see FSOS-032); pre-patch
callback now recoverable; campaign state unaffected; ambiguous correlation fails closed + visible.
Files: src/lib/comms/send.ts, dispatcher.ts, messaging.ts, events.ts (findMessageById),
app/api/webhooks/twilio/status/route.ts, app/api/webhooks/resend/route.ts.
Tests: tests/comms-inbound-e2e.test.mjs Scenario 10 (real Postgres) — correlate a provider_id-null
row by mid + advance lifecycle; uncorrelated event still recorded.
NOT VERIFIED — LIVE: real Twilio StatusCallback / Resend webhook echoing the key in production.

## FSOS-032 — Event ledger idempotency — RESOLVED — CODE VERIFIED
Root cause (proven): comm_message_events had no idempotency key; at-least-once provider redelivery
appended duplicate rows (aggregate rates were safe — read off the reconciled parent columns — but
the per-message timeline dup'd).
Fix: migration 122 adds a plain unique index (message_id, event, provider_id) — NULL tuples are
distinct so orphan/internal rows are unconstrained AND onConflict can infer it — and
recordMessageEvent upserts with ignoreDuplicates so a redelivered identical callback is a no-op; an
uncorrelated event is still appended (fail-open on the row, never dropped).
Files: supabase/migrations/122_comm_message_events_dedupe.sql, src/lib/comms/events.ts.
Tests: comms-inbound-e2e Scenario 10 — a duplicate correlated callback keeps the row count at 1.
NOT VERIFIED — LIVE: migration 122 applied to production Supabase (prod migration deferred).

## FSOS-041 — Reschedule overlap → opaque 500 — RESOLVED — CODE VERIFIED
Root cause: manage.ts classified only 23505 (unique) → a range-overlap collision (23P01, GiST
exclusion mig 091/119) fell through to a generic 500 instead of a 409/taken.
Fix: reuse the shared isSlotCollision() (insert-errors.ts) which recognizes BOTH 23505 and 23P01;
routes already map kind:'taken' → 409. Non-collision errors still surface as error.
Files: src/lib/booking/manage.ts. Tests: tests/booking-insert-errors.test.mjs (classifier contract).

## FSOS-042 — Reschedule self-collision — RESOLVED — CODE VERIFIED
Root cause: computeSlotsForType re-validated the new slot while the appointment being moved was
still status='scheduled' and the busy query had no id-exclusion → the moving row counted against
its own capacity/buffer, blocking its replacement time (capped types / non-zero buffers).
Fix: computeSlotsForType gains excludeAppointmentId; the busy query applies `.neq('id', …)`;
rescheduleAppointment passes appt.id. Every OTHER appointment still counts; the unique/GiST commit
guards are untouched.
Files: src/lib/booking/slots.ts, manage.ts. Tests: tests/booking-reschedule-self-exclude.test.mjs
(RLS, real Postgres) — RED→GREEN: self-exclusion frees the day; excluding a different id does not
(capacity still enforced); own slot re-offered.

## FSOS-050 — AI roster overstates live surface — RESOLVED — CODE VERIFIED (ledger corrected)
Root cause: the roster is metadata for many keys; not all are live agents, and the Phase-1 census
MIS-CLASSIFIED executive_intelligence and pipeline as non-executing — both ARE live
(executive_intelligence via the FSA-assistant + household next-action runGateway routes; pipeline as
the Pipeline Win-Back campaign's AI-author key). Genuinely non-executing: agency_growth,
case_management, document_intelligence (roadmap); routing/taxonomy-only: agency_activation,
referral_triage; detection-job labels: data_quality, commission_reconciliation; life_winback is
wired but disabled-by-default.
Fix: added a runtime SURFACE classification (roster.ts: AGENT_SURFACE + agentSurface) verified
against actual callers, and rendered it as a column in the AI Operations agents page so the roster
never overstates what executes. No agent behavior was invented.
Files: src/lib/ai/roster.ts, app/(fsa)/app/ai/agents/page.tsx. Tests: tests/ai-roster-surface.test.mjs.

## FSOS-060 — API mutations lacked MFA/step-up — RESOLVED — CODE VERIFIED (bounded)
Root cause: the Next middleware matcher excludes /api/*, so API mutation routes were not subject to
the MFA/step-up gate page navigation enforces (e.g. /api/super/users mints admin/super_admin).
Fix: requireApiRole now applies the SAME mfaLevel(portal) decision as the page guard — aal1 refused
on required/mandatory_stepup portals, stale step-up refused on /super — at the shared primitive, so
every gated route inherits it. Authenticated callers already hold aal2 via the page guard, so no
legitimate flow regresses.
Files: src/lib/auth/api.ts. Tests: tests/api-auth-stepup.test.mjs (401/403 matrix incl. mfa_required
+ stepup_required + authorized happy paths).

## FSOS-062 — Public unauthenticated service-role intake — RESOLVED — CODE VERIFIED
Root cause: /api/agencies/upload and /api/agencies/referral are public, unauthenticated,
service-role writes with NO rate limit, honeypot, or audit (the hardened public template is
/api/public/refer). Public is BY DESIGN (the upload/referral partner forms), so the fix is abuse
controls, not an auth wall.
Fix: both routes now rate-limit per IP (429 on flood), honeypot the hidden `company` field (writes
NOTHING when filled), and writeAudit every attempt. Existing size/ext and validation checks kept.
Files: src/app/api/agencies/upload/route.ts, src/app/api/agencies/referral/route.ts.
Tests: tests/agency-intake-hardening.test.mjs — RED→GREEN honeypot-no-write, 429 flood, audited
happy path.

## FSOS-061 / FSOS-063 / FSOS-064 / FSOS-065 — PARTIALLY RESOLVED — structural remainder
These are systemic and cannot be fully corrected by a bounded change without an architecture
migration; the highest-risk bounded protections (FSOS-060 step-up, FSOS-062 abuse controls) are
implemented above. Remaining, documented precisely:
- FSOS-061 (service-role everywhere; RLS not an API backstop): the API data path uses the
  service-role client on ~all routes, so RLS is not a backstop. A true RLS-scoped API path is an
  architecture migration across the route surface. NOT attempted here. Interim: authorization is
  enforced explicitly by requireApiRole + requirePermission (+ now step-up); every public write is
  gated by abuse controls. NOT VERIFIED — LIVE / STRUCTURAL.
- FSOS-063 (26 requireInternalAuth shared-secret routes): retiring the legacy twins needs LIVE
  confirmation no browser path invokes them. STRUCTURAL — DEFERRED (no safe bounded change).
- FSOS-064 (no per-record ownership on [id] routes; shared-book IDOR risk): safe under the current
  single-practice shared-book model; the unused assert* ownership helpers (session.ts) must be
  wired BEFORE any multi-tenant expansion. STRUCTURAL — DEFERRED.
- FSOS-065 (RLS suite proves only the `authenticated` role the API never uses): needs
  service-role-path authz tests + CI setting CI_REQUIRE_INFRA=1. NOT VERIFIED — LIVE.

## FSOS-070 / FSOS-071 — RESOLVED — CODE/CONFIG VERIFIED
FSOS-070 workforce scheduling: done in Batch 1b (see above). FSOS-071: the 5 referral-INDEPENDENT
detection jobs were scheduled in Batch 1b; the previously-deferred referral-sla is now ACTIVATED
this batch — the native referral lifecycle is complete (v_referrals_awaiting_action exposes
sla_breached; all intake paths set sla_due_at; "touched" = the first-touch PATCH; terminal states
drop from the view; referralSla escalation is idempotent via an agent_actions dedupe + the
hour-bucket runIdempotent, writes no client message and touches no enrollment). No business
decision remained. Scheduled `0 * * * *` (docs cadence). Files: vercel.json. Tests:
tests/cron-activation.test.mjs. Edge (non-blocking, noted): an archived_at-but-received referral
still counts as breached (view filters deleted_at + status, not archived_at).

## FSOS-072 — workshop-reminders unscheduled — RESOLVED — CONFIG VERIFIED
Scheduled `*/15 * * * *` (dedicated static route; own Vercel-header/CRON_SECRET auth; every send via
sendThroughGate; per-(reg,channel,kind) idempotency via workshop_message_log; is_security firewall).
Files: vercel.json. Test: tests/cron-activation.test.mjs. NOT VERIFIED — LIVE: Vercel firing it.

## FSOS-073 — backup-verify unscheduled — RESOLVED — CONFIG VERIFIED
Scheduled `0 3 * * *` ([job] dispatcher; writes an audit + activities heartbeat only — no send, no
enrollment). Files: vercel.json. Test: tests/cron-activation.test.mjs. NOT VERIFIED — LIVE: the
external pg_dump the heartbeat attests to actually running.

## FSOS-074 — Stale/destructive cron runbook — RESOLVED — CODE VERIFIED
docs/vercel-crons-restore.md rewritten: vercel.json is the single source of truth (no hand-kept
second list that could drop live jobs); the false "trimmed to 2 crons" claim and the partial
12-cron restore list are removed; plan-quota/cadence and execution checks are recorded as LIVE.
Files: docs/vercel-crons-restore.md.

## Findings VERIFIED — NO REPAIR REQUIRED (controls confirmed sound at cc08177)
- FSOS-010 (fail-closed template fetch): CONTROL CORRECT across canonical path + all 4 tick engines
  (Phase-1 update). No code change; still correct at HEAD.
- FSOS-011 (quiet-hours single-sourced): single source of truth retained; the one scoped timezone
  caveat is a LIVE per-recipient-offset data concern, not a code defect.
- FSOS-012 (transactional email bypasses marketing gate): BY DESIGN — transactional/servicing is
  intentionally not business-suppressed; recorded, no repair.
- FSOS-021 (enrollment dedup & duplicate-send prevention): SOUND (unique(campaign_id,member_id) +
  per-touch idempotency). No repair.
- FSOS-031 (webhook signature verification & STOP propagation): SOLID. No repair.
- FSOS-040 (booking double-booking/timezone/cancellation/reminders): SOLID (the reschedule
  self-block + opaque-500 corners are FSOS-042/041, fixed above). No repair to the core.
- FSOS-051 (AI governance & escalation where the engine runs): SOLID; now less dormant after
  FSOS-070/071 activation. No repair.
- FSOS-076 (cron idempotency & concurrency): SOUND (runIdempotent hour-bucket + per-row guards).
  Every job activated this phase was checked against it. No repair.

## Findings — informational / structural, no bounded repair
- FSOS-075 (legacy pg_cron nightly scoring on legacy customers/scores tables): a second, ungoverned
  DB-side scheduler outside the Node JOBS registry. Removing/retiring it is coupled to the legacy
  customers/scores model's lifecycle and requires a production DB change — STRUCTURAL / NOT VERIFIED
  — LIVE. Left intact this batch (no safe bounded change; not reachable by the governed path).

## Independent adversarial review — disposition
An independent reviewer audited the full diff for authorization bypass, service-role misuse,
campaign resurrection, provider bypass, unsafe callback reconciliation, cron races, referral dead
ends, roster mis-representation, false-passing tests, and scope regression. Verdict: APPROVE — no
Critical/High. Confirmed: the `?mid=` / X-FSOS-Message-Id key is inside the SIGNED payload
(requestUrl includes u.search) so it is NOT spoofable/IDOR; the plain (not partial) dedupe index is
the correct onConflict-inferable construction; excludeAppointmentId is only ever appt.id and cannot
bypass capacity; FSOS-060 does not break optional-MFA portals or create a lockout loop; FSOS-062
guards run before any write; no GHL reintroduction; tests fail on revert (real-Postgres + real-handler
bundles). Low findings applied: (1) corrected the misleading "PARTIAL" comment in events.ts to
"plain index — do not convert to partial"; (3) added tests/comms-twilio-requesturl.test.mjs locking
the signature-covers-query property. Accepted/noted (no code change): (2) roster-surface test asserts
by fiat (callers manually re-confirmed live); (4) backup-verify is a liveness heartbeat, not a
restore test (honest in-code); (5) rate limiter is per-instance best-effort (documented); (6) added a
PRE-DEPLOY check to the live runbook to confirm all fsa/admin/compliance/super users are aal2 before
the FSOS-060 API step-up enforcement goes live.
