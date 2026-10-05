# FSOS Automation E2E Repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> Repairs run **one at a time** (never parallel on the same files). Each task = one commit with its regression test.

**Goal:** Make every automation FSOS presents as automatic either execute correctly end-to-end through the existing
chokepoint, or say truthfully that it does not — without loosening any gate rule and without turning anything on.

**Architecture:** No new send path. Every fix lands in the existing module that owns the link (chokepoint readers,
`policy-resolver`, `inbound`, `workforce`, the engine ticks, the booking hook, the cron route) and is proven by a
top-level `tests/*.test.mjs` file in the custom harness. Any consumer that is connected or moved server-side ships behind
one new tri-state switch (`off` / `canary` / `on`, default `off`), where `canary` sends only to verified addresses in the
existing `comms_test_recipients` allow-list (migration 087).

**Tech Stack:** Next.js 15 App Router, TypeScript strict, Supabase (service-role `getDb()`), custom node test harness
(`node:assert/strict`, bare `.mjs`/`.mts` under `tests/`, offline compile via `tsc`/esbuild as existing tests do).

**Source of truth for defects:** `docs/ops/automation-inventory.md` (IDs like `A-02`, `AUTO-26`).

**Plan status:** checkpoint draft awaiting owner approval. Steps name exact files, functions, tests and assertions; the
code itself is written test-first per task after approval, because each implementer must first re-read the cited lines
and several tasks change shape with the owner's policy answers. This is a deliberate deviation from writing-plans'
"complete code in every step".

## Global Constraints

- Gate integrity: never loosen consent, DNC/STOP, quiet hours, approved-template, no-recommendation or securities rules;
  never default consent to true; no bypass. Tasks marked **[POLICY]** wait for the owner's answer to the numbered
  gate-policy question in the inventory §6 and are skipped if not approved.
- Connected is not enabled: nothing disabled/paused/draft is turned on. New consumers default `off`.
- Hard stops (ask first): production writes (incl. migrations being applied), cron schedule changes, env changes,
  enabling any switch, any gate-policy change, merge/deploy.
- Schema changes = new migration in `supabase/migrations/` (next free number after `137`) with a tested rollback file and
  RLS on any new table. Never edit an existing migration. Never delete data.
- Tests: top-level `tests/<name>.test.mjs` only (discovery is one level deep — confirm with
  `node scripts/run-tests.mjs --list`); `node:assert/strict`; no framework, no `describe/it`.
- Checks per task: targeted test → `npm run type-check`. End: `npm test`, `npm run lint`, `npm run build`.
- Each task's implementer **reads the cited lines first**; line numbers are from `main @ 590cf3a`.

## File structure (created)

| File | Responsibility |
|---|---|
| `src/lib/ops/automation-switch.ts` | Pure `decideSwitch(state, address, canarySet)` + DB resolver `resolveAutomationSwitch(key)` (fails closed to `off`) + `isCanaryRecipient(channel, address)` reading verified `comms_test_recipients`. |
| `supabase/migrations/138_automation_switches.sql` (+ `138_automation_switches.rollback.sql`) | `automation_switches(key pk, state check in ('off','canary','on') default 'off', note, is_assumption, updated_at, updated_by)`; RLS: super/fsa read, super write; seeded rows all `off`. |
| `src/lib/booking/appointment-booked.ts` | One shared "an appointment now exists for this household/contact" fan-out, extracted from `book.ts:231-252`, called by every appointment insert. |
| `src/lib/ops/automation-status.ts` | Read model: per automation → last successful run (`job_runs`), next run (from `vercel.json` schedule), pending depth (queue table count). Feeds UI status. |
| `src/lib/ops/automation-registry.ts` | Declared list of every UI-presented automation → trigger (cron key / webhook route / event) + consumer module. Single source for status pages and the wiring test. |
| `tests/automation-wiring.test.mjs` | #265-class guard (Task 22). |
| other `tests/*.test.mjs` | One per task, named below. |

---

## Phase A — anything that can send when it shouldn't

### Task 1: Chokepoint readers fail closed on a returned `{error}` (A-02, B-01)

**Files:** Modify `src/lib/comms/contact-consent-read.ts:35-149` (`durableContactConsentGranted`,
`contactConsentRevoked`, `isOnDNC`). Test: `tests/comms-readers-fail-closed.test.mjs`.

**Interfaces:** unchanged signatures. Contract made true: on `{ data: null, error }` →
`isOnDNC` → `true`; `contactConsentRevoked` → `true`; `durableContactConsentGranted` → `false`.

- [ ] Step 1 — failing test: compile the module offline (pattern: `tests/comms-stop-contact-consent.test.mjs`), stub
  `getDb()` so every query builder resolves `{ data: null, error: { message: 'timeout' } }` without throwing; assert the
  three restrictive answers above, for sms (10-digit tail and short) and email branches. Also assert a stub returning
  `{ data: [], error: null }` keeps today's permissive answers (no regression).
- [ ] Step 2 — run `node tests/comms-readers-fail-closed.test.mjs`; expect FAIL on the `{error}` cases.
- [ ] Step 3 — in each query branch destructure `{ data, error }` and `if (error) return <restrictive>` before reading
  `data`. Same shape as `suppression.ts:229-236`.
- [ ] Step 4 — re-run the test (PASS) and `node tests/dispatch-chokepoint.test.mjs`, `tests/chokepoint-paths.test.mjs`.
- [ ] Step 5 — `git commit -m "fix(comms): fail closed when a consent/DNC read returns an error"`.

(`conversationIsSecurity`'s catch→false is documented as intended; left as is and listed as a policy note.)

### Task 2: Frequency caps count every accepted send (A-03, E-01, H-02)

**Files:** Modify `src/lib/comms/policy-resolver.ts:111-122` (`base()` and `lastSend`). Test:
`tests/comms-frequency-accepted-sends.test.mjs`.

**Interfaces:** `resolveFrequency(...)` unchanged. Counting predicate becomes: `direction='outbound'` AND
`sent_at IS NOT NULL` (provider accepted) — any later lifecycle status (`delivered`, `opened`, `clicked`, `failed`,
`bounced`, `complained`) still counts as a touch.

- [ ] Step 1 — failing test: stub `getDb()` with a recording query builder; assert the six count queries and the
  last-send lookup do **not** filter `delivery_status='sent'` and **do** filter `sent_at` not null; then a semantic case:
  rows `[{status:'delivered', sent_at: 1h ago}, {status:'delivered', sent_at: 2h ago}]` against `max_sms_per_day=2` →
  `allowed=false`, `minutesSinceLastSend=60`.
- [ ] Step 2 — run; expect FAIL.
- [ ] Step 3 — replace `.eq('delivery_status','sent')` with `.not('sent_at','is',null)` in `base()` and `lastSend`.
- [ ] Step 4 — PASS + `node tests/comms-policy.test.mjs`, `tests/comms-frequency-purposeless.test.mjs`.
- [ ] Step 5 — `git commit -m "fix(comms): count delivered messages toward frequency caps"`.

### Task 3: Stop conditions reach every member who shares the address (B-04)

**Files:** Modify `src/lib/comms/conversations.ts:40-88,148-160` (add `resolveAllMembers(channel, address)`; make
`resolveContact` deterministic with `ORDER BY created_at, id`), `src/lib/comms/inbound.ts:101-197,210-248,396-397,
457-495` (pause / terminate / client-suppression loop over all matched member ids). Test:
`tests/comms-shared-address-stops.test.mjs`.

**Interfaces:** Produces `resolveAllMembers(channel: 'sms'|'email', address: string): Promise<string[]>` (member ids whose
normalized phone tail / lower-cased email equals the address; `[]` on error → callers fall back to `conv.member_id`).

- [ ] Step 1 — failing test: two members share one phone; inbound "please stop texting me" → both members' enrollments
  terminated and both get a client suppression; inbound "sure, when?" → both paused; STOP keyword → both terminated.
- [ ] Step 2 — FAIL. Step 3 — implement. Step 4 — PASS + `tests/comms-stop-intent.test.mjs`.
- [ ] Step 5 — `git commit -m "fix(comms): apply reply/stop conditions to every member sharing the address"`.

### Task 4: Workforce stands down for already-contacted, replied, booked, enrolled or ineligible targets (F-01, F-02, D-03, E-02, I-01)

**Files:** Modify `src/lib/ai/outreach.ts:146-168` (pure `selectForQuota` gains an `exclusions` input) and
`src/lib/ai/workforce.ts:141-262,286-332` (each candidate source attaches `exclusionReason` when: a prior
`outreach_queue` row for the same `(agent_key, entity)` has status `sent` **[policy Q18 default: first touch is one-time;
follow-up belongs to the campaign engines]**; the member has an inbound message in the last `resume_quiet_days`; the
household/contact has an upcoming `scheduled` appointment; the household has a live Life / Win-Back / Cross-Sell
enrollment; for term_conversion the policy `status` is not in the active set). Test: `tests/workforce-standdown.test.mjs`.

**Interfaces:** `selectForQuota(candidates, quota)` unchanged signature; candidates with `exclusionReason` land in
`skipped` with that reason (so the quota rolls to the next candidate — fixes F-07 starvation).

- [ ] Steps: failing pure test on `selectForQuota` (already-contacted / booked / enrolled / replied / inactive-policy each
  skipped with reason; quota fills from the next candidates) → FAIL → implement the pure filter and the four DB lookups
  (batched per run, fail closed: a lookup error excludes the candidate) → PASS + `tests/workforce.test.mjs`,
  `tests/workforce-suppression.test.mjs` → commit `fix(ai): workforce never re-sends a first touch or contacts booked, replied or enrolled targets`.

### Task 5: referral_followup marks the referral touched; recipient pinned at dispatch (H-01, I-01, E-03, F-04)

**Files:** Modify `src/lib/ai/workforce.ts:427-447,478-502`. Test: extend `tests/workforce-standdown.test.mjs`.

- [ ] On a successful `referral_followup` send: `update referrals set first_touch_at=now(), status='working' where id=…
  and first_touch_at is null` (conditional; audited via `writeAudit`). At dispatch load `item.member_id`'s own phone/email;
  if missing or changed → status `skipped`, `block_reason='recipient_changed'`; pass that address as `to`.
- [ ] Commit `fix(ai): record referral first touch and send only to the queued member`.

### Task 6: One shared appointment-booked fan-out, called by every appointment insert (D-02, I-02, G-01, G-02)

**Files:** Create `src/lib/booking/appointment-booked.ts` (`onAppointmentBooked({ householdId, contactId, memberId,
appointmentId, actor })` → exits xsell/life/winback enrollments (existing `exitOnAppointment` functions), expires today's
`queued` `outreach_queue` rows for the household; resolves household via `contact_id → contacts.household_id` when
`appointments.household_id` is null). Modify `src/lib/booking/book.ts:231-252` (call the module), `src/app/api/reviews/
route.ts:64-75` (call it after the appointment insert), `src/lib/life-campaign/eligibility.ts` + `data.ts` (add
`hasUpcomingAppointment` input, exit reason `appointment_booked`), `supabase/migrations/139_winback_view_appointment_contact.sql`
(+ rollback: recreate `v_pipeline_winback_due` appointment CTE joining `appointments.contact_id → contacts.household_id`),
`src/lib/cross-sell-life/data.ts:219-227` (same join). Test: `tests/appointment-booked-standdown.test.mjs`.

- [ ] Failing tests: review-scheduled appointment exits the household's life enrollment; Life eligibility with an upcoming
  appointment returns exit `appointment_booked`; a native booking whose `appointments.household_id` is null still counts
  through `contact_id`. → implement → PASS + `tests/pipeline-winback-booking-exit.test.mjs`,
  `tests/life-campaign-eligibility.test.mjs` → commit `fix(booking): every appointment stops prospecting for that household`.
- Generic native drips are **not** auto-stopped (no documented rule; policy Q18) — listed, not changed.

### Task 7 [POLICY Q4]: START/YES handling (B-02)

**Files:** `src/lib/comms/keywords.ts:9-17`, `src/lib/comms/inbound.ts:251-290,411-415`. Test:
`tests/comms-start-keyword.test.mjs`. If approved as recommended: opt-in keywords match only a bare keyword message;
`applyOptIn` restores only when the latest state is a keyword revoke, never creates consent where none existed, never
deletes DNC rows whose `source` is bounce/complaint/unsubscribe; "Yes, Tuesday works" becomes a normal reply (pause +
escalate). Commit `fix(comms): a conversational yes is a reply, not an opt-in`.

### Task 8 [POLICY Q5]: `durableConsentGranted` honours a recorded revoke (G-08)

**Files:** `src/lib/comms/dispatch-policy.ts:520-524,549-552`. Test: `tests/comms-durable-consent-revoke.test.mjs`
(revoked member + durable basis → consent false). Commit `fix(comms): a recorded revoke overrides a durable consent basis`.

### Task 9 [POLICY Q6]: Life Conversion business-suppression backstop (D-01)

**Files:** `src/lib/life-campaign/tick.ts:286-342` — before each touch call `resolveEffectiveSuppression` (fail closed) and
mark the execution `suppressed` (mirror `workforce.ts:441-445`). Test: `tests/life-campaign-suppression.test.mjs`.

---

## Phase B — term conversion

### Task 10: Life Conversion enrollment sweep fits the window and de-duplicates its tasks (D-04)

**Files:** `src/lib/life-campaign/tick.ts:172-216`, `src/lib/life-campaign/enroll.ts:73-86`. Test:
`tests/life-campaign-sweep.test.mjs`: candidates filtered to `days_remaining >= 180 + early_enrollment_buffer_days - 1`
in the query; terminal (completed/exited) enrollments are not re-evaluated; the `insufficient_time` work_task is
select-before-insert per policy. Commit `fix(life-campaign): enrollment sweep no longer starves or floods tasks`.

### Task 11: Life eligibility exits on an inactive policy (D-09)

**Files:** `src/lib/life-campaign/eligibility.ts:68-93`, `data.ts`. Exit reason `policy_inactive` when
`household_policies.status` ∉ `('active','bound','renewed')` (values confirmed from migration 009 before coding).
Test: extend `tests/life-campaign-eligibility.test.mjs`. Commit `fix(life-campaign): stop touches when the policy is no longer in force`.

### Task 12: An unapproved template holds the touch instead of burning it (D-06)

**Files:** `src/lib/life-campaign/tick.ts:230-234` (release the claim and keep the cursor, as for gate deferrals).
Test: extend `tests/campaign-deferral-durability.test.mjs` pattern in `tests/life-campaign-template-hold.test.mjs`.
Commit `fix(life-campaign): hold a touch whose template is not yet approved`.

### Task 13 [POLICY D-05]: A2P hold scope

If approved: while A2P is held, only SMS/AI touches defer; email and advisor touches proceed (`tick.ts:118-125,263-266`).
Test `tests/life-campaign-a2p-scope.test.mjs`.

---

## Phase C — provider callbacks and status truth

### Task 14: Lifecycle status is monotonic (A-11, B-07, B-08)

**Files:** `src/lib/comms/events.ts:90-178` (rank: queued < sent < delivered < opened < clicked; terminal failures
`failed/bounced/complained/undelivered` never overwritten by `delivered`/`sent`; apply via conditional update on the
current status), `src/lib/comms/send.ts:793-806` (post-dispatch patch only sets `provider_id/sent_at` and status when the
row is still pre-send). Test: extend `tests/comms-message-status.test.mjs`. Commit `fix(comms): callbacks never regress message status`.

### Task 15: Provider errors classified; synchronous 21610 and invalid numbers handled (A-07, B-05, B-06)

**Files:** `src/lib/messaging.ts:215-243` (parse Twilio JSON error `code`; return `{ ok:false, providerCode, permanent }`),
`src/lib/comms/send.ts:801-805` (record `delivery_status='failed'`, `error`, not `blocked`; on 21610 call
`recordChannelOptOut`). Number flag for 21211/21614 = **[POLICY Q13]**. Test: `tests/comms-provider-errors.test.mjs` (mock
at the provider-client boundary via `MessagingDeps`). Commit `fix(comms): classify provider rejections and honour a synchronous 21610`.

### Task 16: Resend idempotency key per message (A-10)

**Files:** `src/lib/messaging.ts:197-208` (pass `Idempotency-Key: <comm message id>` when the caller supplies one;
Twilio has no message-create idempotency — duplicates stay prevented by claims). Test: extend
`tests/dispatch-chokepoint.test.mjs`. Commit `fix(comms): send a Resend idempotency key per message`.

### Task 17: Suppression writers surface failures; webhooks ask the provider to retry (B-14, B-13)

**Files:** `src/lib/comms/opt-out.ts:53-98`, `unsubscribe.ts:105-129`, `deliverability.ts:42-43` (check `error`, audit,
return `ok:false`), `src/app/api/webhooks/resend/route.ts` and `twilio/status/route.ts` (5xx on a failed suppression
write), `src/lib/comms/inbound.ts:315-373` (apply a STOP opt-out keyed on `From` before threading). Test:
`tests/comms-suppression-write-errors.test.mjs`. Commit `fix(comms): a failed opt-out write is never reported as success`.

### Task 18 [SWITCH `callback_engine_state`, default off]: Callbacks reach engine state (B-10, D-12)

**Files:** `src/lib/ops/automation-switch.ts` + migration 138 (created here — first switch), `src/lib/comms/events.ts`
(after the lifecycle update, if switch ≠ off: map `comm_messages.entity_type/entity_id` to the engine execution; a
permanent failure or 21610 marks the execution failed and exits the enrollment with `undeliverable`). Test:
`tests/automation-switch.test.mjs` (pure tri-state + canary membership + fail-closed resolver) and
`tests/callback-engine-state.test.mjs`. Commit `feat(ops): off/canary/on automation switch; callbacks can stop dead-number cadences`.

---

## Phase D — remaining workflows

### Task 19 [HARD STOP: cron schedule + POLICY Q3]: Campaign dispatch and district nurture run inside the window (A-05, A-06, C-02, J-02, J-03)

**Files:** `vercel.json` (`campaign-dispatch` `0 12 * * *` → `0 16 * * *`; `district-nurture-tick` `0 14 * * *` →
`0 16 * * *` — only if approved), and if Q3 = hold: `src/jobs/handlers.ts:243-256` and `src/lib/comms/campaign.ts:305-317`
treat a `quiet_hours` block on a *scheduled* touch as hold (cursor kept / claim released), gate unchanged.
Tests: `tests/cron-window.test.mjs` (every send-capable cron's UTC hour is inside 09:00–20:00 America/Chicago on
2026-10-30 and 2026-11-02), `tests/campaign-quiet-hours-hold.test.mjs`.

### Task 20 [HARD STOP: needs CRON_SECRET confirmed]: Cron routes require the Bearer secret (A-01, C-07, J-01)

**Files:** `src/app/api/cron/[job]/route.ts:14-21`, `booking-reminders/route.ts:29-34`, `social-publish/route.ts:17-22`
(match `workshop-reminders`). Test: extend `tests/workshop-lifecycle-routes.test.mjs` pattern in
`tests/cron-auth.test.mjs` (header alone → 401; Bearer → 200). **Do not merge until the owner confirms `CRON_SECRET` is set
in Vercel Production** — otherwise every cron stops.

### Task 21: Remaining engine fixes (one commit each)

| Sub | Defect | Files | Test |
|---|---|---|---|
| 21a | `runIdempotent` records failures / `ok:false` and reports DB errors (J-07, H-15) | `src/lib/jobs/runtime.ts` | `tests/jobs-runtime-failures.test.mjs` |
| 21b | Drip: a non-active sequence holds enrollments (not `completed`); sequence activate action [SWITCH `native_drip`] (C-01) | `src/jobs/handlers.ts:183-187`, `api/comms/sequences/[id]` | `tests/drip-sequence-hold.test.mjs` |
| 21c | `campaign-dispatch` honours `marketing_automation` and the global gateway switch (C-05) — prod has 0 active campaigns, so nothing halts | `src/jobs/handlers.ts:137-151` | `tests/campaign-dispatch-killswitch.test.mjs` |
| 21d | Win-Back `in_conversation` = open **and** last inbound (E-06); campaign stays paused | `src/lib/pipeline-winback/data.ts:72-81,112` | `tests/pipeline-winback-conversation.test.mjs` (extend) |
| 21e | Cross-Sell purpose validated on settings/enable (E-07); seed fix as migration **[POLICY Q19]** | `api/cross-sell-life/*settings*`, `campaign-config.ts:32-36` | `tests/cross-sell-life-control-contract.test.mjs` (extend) |
| 21f | District nurture pause keyed on the agent's own thread (B-11, H-06, H-07) | `src/lib/district-nurture/data.ts:97-106`, `inbound.ts` | `tests/district-nurture-eligibility.test.mjs` (extend) |
| 21g | Public referral intake writes `owner_scope: null`; no DB error text to anonymous callers (H-03) | `src/app/api/public/refer/route.ts:36,51` | `tests/public-intake.test.mjs` (extend) |
| 21h | Workshop kill switch fails closed on a config read error (G-07) | `src/lib/workshops/comms-engine.ts:91-127` | `tests/workshop-engine-invocation.test.mjs` (extend) |
| 21i | Social publisher refuses revoked/deleted channels; disconnect cancels pending entries (H-10) | `src/lib/social/publisher.ts:99-117`, `channels.ts:244-255` | `tests/social-schedule.test.mjs` (extend) |
| 21j | Retry sweeps re-dispatch orphaned claims through the tick path, gate re-run, same idempotency key [SWITCH `engine_retry_redispatch`] (D-07, E-10, H-11, J-06) | `src/lib/{life-campaign,pipeline-winback,cross-sell-life,district-nurture}/jobs.ts` | `tests/engine-retry-redispatch.test.mjs` |

---

## Phase E — UI truthfulness, #265 class, design pass

### Task 22: #265 failure-class wiring guard

**Files:** Create `src/lib/ops/automation-registry.ts` (every UI-presented automation: `key`, `ui` route, `trigger:
{ kind:'cron', job } | { kind:'webhook', route } | { kind:'manual' } | { kind:'none', reason }`, `consumer` module path,
`switch` key). Create `tests/automation-wiring.test.mjs` asserting: (1) every `vercel.json` cron resolves to a `JOBS` key
or static route **and** every `JOBS` key is scheduled or declared an alias; (2) every registry entry with
`trigger.kind='cron'` exists in both; (3) every roster agent shown active (`src/lib/ai/roster.ts`) and every exported
playbook trigger list (`EVENT_DRIVEN_SMS`, playbook follow-up fields) has a registry entry whose consumer file imports it,
or is declared `trigger.kind='none'` with `reference: true` — which the UI must render as reference copy; (4) every
registry `consumer` path exists. The test must fail on today's `main` (EVENT_DRIVEN_SMS, workflow builder, scheduled
reports, roadmap agents) — prove that before the UI fixes land.

### Task 23: Truthful status from execution evidence

**Files:** Create `src/lib/ops/automation-status.ts`; modify `src/lib/ai/command-center.ts:102-120,175-179` ("Working now"
requires a run in the last 26h, else "Idle — no run" / "Enabled, no candidates"), `src/app/(super)/super/jobs/page.tsx:14`
(registry-driven, shows last success / failure / stale), `src/components/app/CampaignHealthPanel.tsx:105-109`,
`src/app/api/cross-sell-life/health/route.ts:24-32`, campaign hub tiles. Tests: `tests/automation-status.test.mjs`,
extend `tests/command-center.test.mjs`.

### Task 24: Misleading copy and dead controls

`pipeline-winback/[id]/page.tsx:249-263` ("Reference copy — not dispatched"; link to booking notifications) and playbook
follow-up fields (#265 option 3, plus option 2 link); `/app/workflows` (Enable disabled, "Not executed — no automation
engine"); `/app/reports/scheduled`; `/super/webhooks`; `/app/comms/delivery` retry claim; `/admin/data/exports`;
documents request copy; conversion monitoring ("Detection signals", not "outreach activity"); cross-sell "contacted";
`CampaignEngineControls.tsx:79` ("sends on the next daily run"); `/app/winback` AI panels. Test: the Task 22 guard plus
`tests/ui-truth-copy.test.mjs` (string presence on the rendered components' source where a render harness exists).

### Task 25: frontend-design → impeccable → Playwright

Load `frontend-design` then `impeccable` for every surface touched in Tasks 23–24. Browser verification on a local build
only: `next dev` on `http://127.0.0.1:3737`, `COMMS_CAPTURE_TRANSPORT` set, `SMS_A2P_APPROVED` unset, no provider keys,
database = local Supabase stack (Docker) seeded with synthetic data, or public/unauthenticated surfaces only if the stack
cannot start. Report base URL / DB / credential names before running; never against production.

---

## Execution order and gates

1. Phase A tasks 1–6 (no policy dependency) → Phase B 10–12 → Phase C 14–17 → Phase D 21a, 21c, 21d, 21f–21i →
   Phase E 22–25.
2. Policy-dependent tasks (7, 8, 9, 13, 15-flag, 19, 21e) only after the owner answers; switch-gated tasks (18, 21b, 21j)
   ship `off`; Task 20 waits for `CRON_SECRET` confirmation.
3. After all: `npm test`, `npm run type-check`, `npm run lint`, `npm run build`; final adversarial review in a fresh
   subagent that wrote none of the repairs; report `docs/ops/automation-audit-report.md`; PR description links it.
