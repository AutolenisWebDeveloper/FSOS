# FSOS Automation Inventory

**Resume point for the automation audit** (brief: `docs/ops/automation-audit-brief.md`). Keep this file current as
repairs land; it is the first thing a resumed or compacted session reads.

| | |
|---|---|
| Branch | `fix/automation-e2e` (from `main` @ `590cf3a`) |
| Phase | **1 — inventory complete. 2 — CHECKPOINT: awaiting owner approval. No repairs started.** |
| Investigation | 10 read-only investigators + 10 adversarial verifiers + 1 completeness critic (Workflow run `wf_452815d2-bef`, 2026-10-02). 191 defect claims → 188 CONFIRMED/PARTLY, 3 REFUTED. Highest-impact citations re-read by the orchestrator (marked ✔). |
| Production snapshot | Read-only aggregate SELECTs against Supabase project `supabase-FSOS` on 2026-10-02 (counts/statuses/ages only; no names, phones, emails, bodies). |
| Unit baseline | `npm test` → **All 213 unpinned unit test file(s) passed** (exit 0) on `475af87`, before any change. RLS set not run (needs root Postgres; run only when asked). |
| Not available this session | Vercel connector cannot see the FSOS project (0 projects in team) → no runtime logs/cron config/env names. Twilio connector is docs-only → no account counts/webhook config. No Resend connector. Canary contacts arrived as blank placeholders → **no live send possible**. |

## Legend

**Status (current, pre-repair):** `OPERATIONAL-IN-CODE` every link exists in code, no live proof · `PARTIAL` implementation
exists, a named defect or dependency breaks a link · `BROKEN` defect stops the chain or makes it send wrongly ·
`DISCONNECTED` trigger or consumer missing · `DISPLAY-ONLY` UI/config with no executor · `DETECTION-ONLY` writes
signals nobody acts on (by design or not) · `DISABLED` switched off in production (state as found; stays off) ·
`DRAFT-ONLY` produces drafts for a human by design · `PLANNED / NOT BUILT`.

**Evidence:** `CODE-TRACED` (file:line) · `TEST-COVERED` (named mocked test; ✓ = in the unit set that passed in the
baseline run this session; ◇ = RLS set, not run) · `PROD-AGG` (read-only production aggregate) · `LIVE-VERIFIED` — none
(no canary contacts).

## 1. Production snapshot (2026-10-02, read-only aggregates)

| Signal | Value |
|---|---|
| Cron execution (`job_runs`) | All 24 `[job]`-routed jobs run on schedule; 0 failed, 0 stuck. Daily jobs 7/7d, 30/30d; hourly sweeps 168/7d, 720/30d. Last runs 2026-10-01/02. `booking-reminders`, `workshop-reminders`, `social-publish` routes do not write `job_runs` (no execution record). |
| Outbound messages (`comm_messages`) | 118 total; **0 in last 30 days** (last 2026-08-26). 0 inbound rows ever. Blocks: ai_authority 30, suppression 15, consent 7, quiet_hours 5, approved_template 3, personalization 1. |
| Provider callbacks (`comm_message_events`) | Correlated: SMS through 2026-08-13; email through 2026-08-26. **Orphan email sent/delivered events (no `message_id`): 116, 75 in 30d, 14 in 7d, still arriving (last 2026-10-01 11:00 UTC)** — direct transactional sends write no `comm_messages` row (or another sender shares the Resend webhook). Orphan SMS events 124 sent/109 delivered/18 failed, all 2026-08-04..10. |
| Enablement | `ai_policies.global.gateway_enabled=true`; all 16 `ai_agents` enabled; `agent_daily_targets`: cross_sell 15 sms, **life_winback 15 email (enabled — migration seed says false)**, referral_followup 15 sms, term_conversion 15 sms. `life_campaigns`, `pipeline_winback_campaigns`, `xsell_life_campaigns` = **paused**; `district_nurture_campaigns` = **draft**. `comm_campaigns`: 4 rows, all paused+archived. |
| Queues / state | `outreach_queue` 0 rows ever; `agent_runs` last 2026-08-13. All enrollment tables 0 rows. `booking_notification_deliveries` **0 rows ever**. `workshop_message_log` **0 rows ever**. `social_schedule_entries` 0. |
| Candidate sources | `v_cross_sell_gaps` 4; `v_referrals_awaiting_action` 6 (5 SLA-breached); `v_conversions_due` 0; `contacts(source=winback_life)` 0; referral workforce candidates 5, **0 with household** → uncontactable. |
| Spine | households 4, members 4, policies 0, referrals 8, opportunities 7, appointments 13 (**6 still `scheduled` with start times in the past**; `reminder_sent_at` null on all). |
| Consent | `consents` **0 rows**; `comm_contact_consents` 9 (sms granted 8, email granted 1); `comm_consent_purposes` 1; `dnc_entries` 0; no `do_not_contact` households; no `is_security` policies. |
| Conversations | 143 threads, **all `open`** (104 last outbound, 39 null), 3 with `ai_autoreply`. Nothing closes threads automatically. |
| Policy rows | `comm_hours_policy.global`: enabled, **09–20, Mon–Fri, fixed `timezone_offset_hours=-6`**. `comm_frequency_policy`: global sms 2/day 5/7d, marketing email 1/day, combined 3/day, min 60m. `booking_reminder_config`: offsets [1440], email+sms on. `workshop_comms_config`: enabled. `comm_identity_config` approved v5. |
| Templates | Booking SMS `appointment-*-sms` approved (migration 135). **No approved email templates under the booking email source keys** (`appointment-confirmation`, `appointment-reminder-email`, …). 116 approved templates have no `source_key`. |
| Other schedulers | pg_cron: 1 active job `fsos-nightly-scoring` 08:00 UTC (scoring, no sends). No `supabase/functions`. GitHub Actions: CI only. |
| Live schema checks | `referrals.owner_scope` is `uuid` (confirms H-03). Supabase branching: only `main`, status `MIGRATIONS_FAILED` since 2026-09-03; migration ledger lists 14 of 139 files (schema applied out-of-band). |

**Reading:** every engine that can message a client is either switched off (campaigns paused/draft) or starved by data
(no `consents` rows, no linked households) — so nothing has sent in 30 days and that is largely *as configured*, not a
crash. The defects below are therefore mostly **latent**: they fire the moment an owner enables an engine or real
consented data arrives. Two inferences, marked **ASSUMPTION** (no env/log access): `SMS_A2P_APPROVED` is not true in
production now (every booking SMS leg returns `sms_a2p_hold` before claiming a ledger row, `src/lib/booking/notify.ts:397-401`,
and no SMS has sent since 2026-08-13), and `CRON_SECRET` may be unset (the only Bearer-only cron, `workshop-reminders`,
has never left a trace). Both must be read from Vercel before any switch is turned on.

## 2. Inventory — one row per automation

Columns per the brief. Cell abbreviations: `h.ts` = `src/jobs/handlers.ts`, `wf.ts` = `src/lib/ai/workforce.ts`,
`dp.ts` = `src/lib/comms/dispatch-policy.ts`. Every send path below converges on the chokepoint (AUTO-01); "gate" means
`sendMessage` → `dispatch` → `messaging.sendSms/sendEmail` → `resolveDispatchPolicy` → `evaluateGate`.

### 2.1 Send infrastructure, callbacks, inbound

| # | Automation | UI surface | Trigger (file:line) | Schedule / registration | Queue / state | Consumer | Gate call | Provider call | Callback handler | Stop conditions | Furthest verified link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-01 | **Outbound chokepoint** (`sendThroughGate` retired; enforcement moved into the provider boundary) | /app/comms/* | any caller → `messaging.ts:315` (email), `:396` (sms) | synchronous | `comm_messages` (only via `send.ts:571-620`) | — | `dp.ts:482` → `gate.ts:252` | Resend SDK `messaging.ts:197-208`; Twilio REST `messaging.ts:230-237` — **the only provider calls in `src/`/`scripts/`** ✔ | AUTO-02/04 | consent/DNC/suppression read per send | provider call | **PARTIAL** — readers fail open on DB error (A-02 ✔), freq caps stop counting delivered (A-03 ✔), no provider idempotency key (A-10), errors unclassified (A-07) | TEST-COVERED ✓ `dispatch-chokepoint`, `chokepoint-paths`; PROD-AGG |
| AUTO-02 | Twilio status callback → lifecycle | /app/comms/delivery | Twilio POST to StatusCallback built `messaging.ts:469-478` | event | `comm_messages`, `comm_message_events` | `twilio/status/route.ts:24` → `events.ts:124-171` | n/a (HMAC verified `twilio.ts:12-27`) | — | itself | 21610 → opt-out (`route.ts:68-84`) | `comm_messages` status | **PARTIAL** — late `delivered` overwrites `bounced/failed` (B-08); post-send patch can regress a faster callback (A-11/B-07); **never updates engine executions/enrollments** (B-10) | TEST-COVERED ✓ `comms-message-status`; PROD-AGG (SMS events to 08-13) |
| AUTO-03 | Carrier opt-out 21610 | — | async callback `twilio/status/route.ts:68` | event | `dnc_entries`, consents | `opt-out.ts:50-99` | later sends blocked `gate.ts:298` | — | — | DNC + consent revoke; **no enrollment termination**; **synchronous REST 21610 unhandled** (`messaging.ts:238`, B-05) | DNC write | **PARTIAL** | TEST-COVERED ✓ `comms-stop-contact-consent` |
| AUTO-04 | Resend webhook → lifecycle + bounce/complaint suppression | /app/comms/delivery | Resend POST `resend/route.ts:61` | event | `comm_message_events`, `dnc_entries` | `events.ts:124`; `deliverability.ts:33-44` | svix verify `resend.ts:14-41` (no timestamp tolerance, B-17) | — | itself | hard bounce/complaint → DNC; soft bounce no | DNC write | **PARTIAL** — unmapped events dropped (B-18); suppression write ignores `{error}` (B-14); transactional sends uncorrelated | TEST-COVERED ✓ `comms-deliverability-suppression`; PROD-AGG (116 orphan events) |
| AUTO-05 | One-click unsubscribe (RFC 8058) + /unsubscribe page | email footer | `comms/unsubscribe/route.ts:28-50`; `consent/opt-out/route.ts:19-74` | event | `dnc_entries` | `unsubscribe.ts:90-130` | dnc step `gate.ts:298` (all email purposes) | — | — | email DNC; enrollments not terminated | DNC upsert (error unchecked) | **PARTIAL** — GET suppresses (B-21); write failure silent (B-14) | TEST-COVERED ✓ `comms-email-deliverability` |
| AUTO-06 | Inbound SMS → thread + history | /app/comms/inbox | `twilio/inbound/route.ts:24-38` → `inbound.ts:296` | event | `comm_conversations`, `comm_messages` | `processInbound` | AI reply only | TwiML | — | keywords, NL stop, reply pause | inbound row + FSA escalation | **OPERATIONAL-IN-CODE**; PROD: 0 inbound ever → provider webhook wiring **UNKNOWN** | TEST-COVERED ◇ `comms-inbound-e2e` |
| AUTO-07 | STOP keyword → DNC + revoke + terminate enrollments | inbox, campaign pages | `keywords.ts:12-17` → `inbound.ts:372-410` | event | 4 enrollment tables | `terminateActiveEnrollments` `inbound.ts:156-197` | dnc `gate.ts:298` | none (relies on Twilio) | — | **one resolved member only** (shared phone B-04 ✔); district nurture & outreach_queue not terminated; STOP lost if threading fails (B-13) | DNC + terminal enrollments | **PARTIAL** | TEST-COVERED ◇ `comms-inbound-e2e` |
| AUTO-08 | START/YES/SUBSCRIBE → opt-in | — | `keywords.ts:9` ✔ (first word) → `inbound.ts:251-262` ✔ | event | consents, `dnc_entries` (delete) | `applyOptIn` | — | — | — | **"Yes, Tuesday works" grants channel consent and deletes internal DNC rows incl. bounce/complaint/unsubscribe** | consent granted | **BROKEN (P0, gate-policy decision)** B-02 | TEST-COVERED ✓ `comms-stop-contact-consent` (restore path) |
| AUTO-09 | HELP / INFO auto-response | — | `inbound.ts:416-438` | event | `comm_messages` | TwiML | none | TwiML | none | returns early: no pause, no escalation (B-03) | TwiML body | **PARTIAL** — possible double HELP reply with Twilio Advanced Opt-Out (policy Q) | CODE-TRACED |
| AUTO-10 | Reply → pause enrollments; `resume-paused` | campaign pages | pause `inbound.ts:102-136,484-495`; resume cron `0 11 * * *` → `h.ts:264` | event + daily | 4 enrollment tables | `resumePausedEnrollments` | next tick gates | — | — | member-keyed; **district nurture & workforce never paused**; resume after `resume_quiet_days`=5 | status restored | **PARTIAL** | TEST-COVERED ◇ `comms-inbound-e2e`; PROD-AGG (job runs daily) |
| AUTO-11 | Natural-language stop → terminate + business suppression | inbox | `stop-intent.ts:101-116` → `inbound.ts:457-479` | event | enrollments, `comm_client_suppressions` | `applyClientSuppression` `inbound.ts:210-248` | suppression step (non-transactional only) | — | — | suppression skipped (warn) when no contact id resolves (F-03) | terminal enrollments | **PARTIAL** | TEST-COVERED ✓ `comms-stop-intent` |
| AUTO-12 | AI auto-reply responder (`conversation`) | inbox thread toggle | `inbound.ts:506-509` → `tryAutoReply :537-631` | event | `comm_messages` | `responder.ts:46` | gate (aiGenerated) | via chokepoint | AUTO-02/04 | turn limit, ai_authority, STOP first | provider send via gate | **OPERATIONAL-IN-CODE** (opt-in per thread; 3 threads on) | TEST-COVERED ◇ `comms-inbound-e2e` |
| AUTO-13 | Inbound email reply | inbox | `webhooks/email/inbound/route.ts:53-84` | event | same as SMS | `processInbound` | AI reply only | — | — | same as SMS except no CANCEL review; handler error returns 200 (H-13) | route + handler | **PARTIAL** — no evidence a provider posts here | CODE-TRACED |
| AUTO-14 | Direct transactional email (visitor ack, FSA alert, password setup, form link) | public forms, admin | `transactional.ts:148,196`; `account.ts:118`; `forms.ts:140` | synchronous | none | — | `sendEmail` policy (waiver / durable basis) | Resend | uncorrelated | DNC (case-sensitive, A-09) | provider accept + audit | **PARTIAL** — no `comm_messages` record (prior F-7) | TEST-COVERED ✓ `chokepoint-paths`, `transactional-notifications` |
| AUTO-15 | Morning briefing email `/api/briefing/send` | — | none — comment claims Vercel Cron (`route.ts:13-15`); absent from `vercel.json` | none | none | — | `sendEmail` (consentWaived, caller-supplied `to`) | Resend | uncorrelated | — | route only | **DISCONNECTED** (A-16) | CODE-TRACED |
| AUTO-16 | Cron dispatcher `/api/cron/[job]` + `runIdempotent` | /super/jobs (hard-coded list, I-10) | Vercel Cron → `[job]/route.ts:23` | `vercel.json` (24 entries) | `job_runs` | `src/jobs/index.ts` JOBS | per job | — | — | dedupe `job:UTC-hour` (`route.ts:35-37`) | job executed | **PARTIAL** — **accepts any request with `x-vercel-cron` header** (`route.ts:14-21` ✔; A-01/J-01); failures erased / `ok:false` recorded completed (J-07, H-15); no `maxDuration` (J-09) | TEST-COVERED ✓ `cron-activation` (one direction, J-15); PROD-AGG |

### 2.2 Native comm campaigns (`comm_campaigns` / `comm_sequences`)

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-17 | Broadcast — activation send | /app/comms/campaigns/[id] | operator `activate` `api/comms/campaigns/[id]/route.ts:105-119` (simulation <24h required) | on click | `comm_campaign_enrollments` (insert-first claim `campaign.ts:262-265`) | `dispatchCampaign` `campaign.ts:224` | `campaign.ts:271` | chokepoint | AUTO-02/04 | unique (campaign, member); Pause | provider send | **OPERATIONAL-IN-CODE** (manual by design); ignores `schedule_at` (C-06) | CODE-TRACED; PROD: 4 campaigns paused+archived |
| AUTO-18 | Broadcast — daily re-dispatch | "Active campaigns — Currently dispatching" | `vercel.json` `0 12 * * *` → `h.ts:137` | **12:00 UTC = 07:00 CDT / 06:00 CST** | `comm_campaigns.status='active'` | `campaign.ts:224` | yes | chokepoint | — | `quiet_hours` is **terminal** (`gate.ts:292-296`, not in `DEFERRAL_GATE_STEPS :368-374` ✔) → SMS recipient permanently `suppressed` (`campaign.ts:317`); email deferred by business hours every day | gate block | **BROKEN** (A-05/C-02/J-02) — SMS never sends from cron; email never sends from cron; ignores `marketing_automation` kill switch (C-05) | CODE-TRACED |
| AUTO-19 | Drip — enrollment + `dripAdvance` | /app/comms/sequences | activation → `campaign.ts:328-342`; advance `h.ts:156` (called from `h.ts:148`) | 12:00 UTC only | `comm_campaign_enrollments` (`next_send_at`) | `dripAdvance` | `h.ts:217` | chokepoint | no enrollment update | status `enrolled`, A2P hold; **no booking/conversion/do_not_contact recheck** (C-03) | — | **DISCONNECTED** — sequences can only be created `draft` (`api/comms/sequences/route.ts:53`); `dripAdvance` silently **completes** enrollments of a non-active sequence (C-01); when reachable, SMS steps burned at 12:00 UTC; no per-step claim (C-08) | CODE-TRACED; TEST-COVERED ✓ `campaign-deferral-durability` (hold path) |
| AUTO-20 | Audience builder (`comm_audiences`) | /app/comms/audience | POST `/api/comms/audiences` | manual | `comm_audiences` | **none** (`campaign.ts:54-77` reads `comm_campaigns.audience.kind` only) | — | — | — | — | row saved | **DISPLAY-ONLY** | CODE-TRACED |
| AUTO-21 | Campaign library blueprints | /app/comms/library | `library/route.ts:29-73` | manual | `comm_templates` (draft) | human approval | — | — | — | — | draft row | **DRAFT-ONLY** (by design) | TEST-COVERED ✓ `comms-library` |
| AUTO-22 | `marketing_automation` agent kill switch | /app/ai agents | — | — | `ai_agents` | **no runtime reader** (`h.ts:137-151`) | — | — | — | — | — | **DISPLAY-ONLY** (C-05/F-13) | CODE-TRACED |

### 2.3 Term conversion

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-23 | **Life Conversion campaign** (enroll sweep + 20-touch tick) | /app/comms/life-conversion | `vercel.json` `0 15 * * *` → `src/jobs/index.ts:51` → `h.ts:411` → `life-campaign/tick.ts:53` | daily 15:00 UTC (10:00 CDT / 09:00 CST) | `life_campaign_enrollments`, `life_campaign_executions` (unique enrollment+touch) | `tick.ts:82-154`; sweep `:172-216` | `tick.ts:286-318` purpose `POLICY_DEADLINE` | chokepoint | comm_messages only | recheck per touch: securities, `do_not_contact`, open/won opportunity; reply pause; public-booking exit | gate | **DISABLED** in prod (paused). Code **PARTIAL/BROKEN**: FSA-scheduled review does not stop it (D-02/I-02 P0); business suppression skipped for `POLICY_DEADLINE` (D-01 P0, policy Q); sweep starves + duplicate tasks (D-04); A2P hold freezes whole cadence (D-05); lapsed/converted policy keeps sending (D-09); unapproved template burns touch (D-06) | TEST-COVERED ✓ `life-campaign-*`, `campaign-deferral-durability`; PROD-AGG |
| AUTO-24 | Life Conversion retry/dead-letter | — | `30 * * * *` → `h.ts:419` → `life-campaign/jobs.ts:28` | hourly | `life_campaign_executions` | `runRetrySweep` | **none — never re-sends** | — | — | dead-letter after 5 | bookkeeping | **BROKEN** (D-07/J-06) | TEST-COVERED ✓ `life-campaign-retry` (pure decision only) |
| AUTO-25 | conversion-watch | /app/conversions/monitoring ("outreach activity") | `0 9 * * *` → `h.ts:53-66` | daily | `activities(kind=conversion_identify)` | **none** | — | — | — | one row per policy forever | activity row | **DETECTION-ONLY**; UI presents it as outreach (D-17/I-09) | CODE-TRACED; PROD-AGG (v_conversions_due 0) |
| AUTO-26 | **term_conversion workforce agent** | /app/ai, command center "Working now" | `0 15 * * *` → `h.ts:366` → `wf.ts:532`; candidates `v_conversions_due` `wf.ts:163-195` | daily 15:00 UTC (same instant as AUTO-23) | `outreach_queue` (**unique per `queue_date`** `034:77` ✔) | `runOutreachAgent` `wf.ts:352` (atomic claim `:395-402`) | `wf.ts:478-497` purpose `POLICY_DEADLINE`, class hard-coded `approved_first_touch` (F-09) | chokepoint | queue row stays `sent` (F-12) | build-time consent/DNC/suppression/securities only | provider send | **BROKEN (P0)** — re-messages the same policies daily (F-01/D-03), no stop on reply/booking/conversion/active Life enrollment (F-02), quota starvation lets deadlines pass (F-07); PROD: enabled, 0 candidates | TEST-COVERED ✓ `workforce` (pure selection); PROD-AGG |

### 2.4 Win-back and cross-sell

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-27 | **Pipeline Win-Back campaign** (sweep + 24-touch tick) | /app/comms/pipeline-winback | `0 15 * * *` → `h.ts:429` → `pipeline-winback/tick.ts:61` | daily 15:00 UTC | `pipeline_winback_enrollments/executions` | `tick.ts:61-160` | `tick.ts:276-307` MARKETING | chokepoint | comm_messages only | recheck per touch; view `has_upcoming_appointment` | gate | **DISABLED** in prod (paused). Code **BROKEN**: pauses itself after touch 1 because its own send opens a conversation that never closes (E-06; prod: all 143 threads open) | TEST-COVERED ✓ `pipeline-winback-*` |
| AUTO-28 | **Win-Back event-driven SMS (#265)** | pipeline-winback/[id] "fire on events" | **none** — `EVENT_DRIVEN_SMS` (`playbooks.ts:247-275`) imported only by `page.tsx:10,256` | none | none | none | none | none | — | — | UI constant | **DISPLAY-ONLY** (E-04/I-03) | CODE-TRACED |
| AUTO-29 | Playbook no-reply nudges, handoff, closing, future follow-up (Win-Back ×6, Cross-Sell ×7) | campaign detail pages | none (E-05) | none | `future_follow_up_at` (no reader) | none | — | — | — | — | UI only | **DISPLAY-ONLY** | CODE-TRACED |
| AUTO-30 | Win-Back / Cross-Sell / District retry sweeps | health panels | `30 * * * *` → `*/jobs.ts runRetrySweep` | hourly | `*_executions` | bump attempts / dead-letter | **never re-sends** | — | — | — | bookkeeping | **BROKEN** (E-10/H-11/J-06) | CODE-TRACED |
| AUTO-31 | Cross-Sell Life daily enrollment | /app/comms/cross-sell-life | `0 13 * * *` → `h.ts:464` → `cross-sell-life/jobs.ts:21` | daily | `xsell_life_campaign_enrollments` | tick | — | — | — | eligibility excludes win-back/life households | enrollment row | **DISABLED** in prod (paused; emergency-stopped 2026-08-05) | TEST-COVERED ✓ `cross-sell-life-eligibility` |
| AUTO-32 | Cross-Sell Life 35-touch tick | same | `0 16 * * *` → `h.ts:473` → `tick.ts:53` | daily 16:00 UTC | executions | `tick.ts:63-157` | `tick.ts:231-263` | chokepoint | comm_messages only | per-touch recheck (no conversation signal) | gate | **DISABLED**; code **PARTIAL** — seeded purpose `CLIENT_CARE_CROSS_SELL` is not a valid purpose → every AI touch held/burned (E-07); two active versions can double-enroll (E-15) | TEST-COVERED ✓ `campaign-template-failclosed` |
| AUTO-33 | Cross-Sell Life intent exits + future follow-up | cross-sell-life detail | manual API only (`conversation/route.ts:23-45`) | none | enrollments | none automatic | — | — | — | wrong-number/deceased never applied from inbound (B-12) | API write | **DISCONNECTED** | CODE-TRACED |
| AUTO-34 | cross-sell-scan | /app/cross-sell ("Households contacted") | `30 9 * * *` → `h.ts:69` | daily | `activities(crosssell_identify)` | **none** | — | — | — | — | activity | **DETECTION-ONLY**; counted as "contacted" (E-16) | CODE-TRACED |
| AUTO-35 | **cross_sell workforce agent** | /app/ai | `0 15 * * *` → `wf.ts:532`; `v_cross_sell_gaps` `wf.ts:141-161` | daily | `outreach_queue` | `wf.ts:352` | MARKETING | chokepoint | — | build-time filters only | provider send | **BROKEN (P0)** — re-invites same households daily; ignores bookings and other enrollments (E-02/F-01/F-02); recipient can change between build and dispatch (F-04); no sender ID (F-05). PROD: enabled, 4 gap households, 0 queued (no `consents` rows) | TEST-COVERED ✓ `workforce`, `workforce-suppression`; PROD-AGG |
| AUTO-36 | **life_winback workforce agent** | /app/winback "AI outreach" | same; candidates `contacts.source='winback_life'` `wf.ts:207-234` | daily | `outreach_queue` | `wf.ts:352` | MARKETING | chokepoint | — | same as cross_sell; no check against Win-Back enrollments | — | **PARTIAL** — PROD: **enabled** (migration 090 seeds it off; someone enabled it), 0 candidates. Same daily-repeat defect class as AUTO-35 | PROD-AGG |
| AUTO-37 | `marketing_automation` audiences `winback` / `cross_sell` (external doc claim) | campaign builder | `resolveAudience` supports `cross_sell`, `conversion`, `contact_segment`, `household_ids`, `all_consented` (`campaign.ts:54-75`); **no `winback` kind** — reachable only via API `contact_segment` preset `win_back` (`segments/rules.ts:79-84`) | 12:00 UTC | comm_campaign_enrollments | AUTO-18/19 | yes | chokepoint | — | — | — | `cross_sell`: **BROKEN** via AUTO-18; `winback`: **NOT BUILT** as named audience. "Create campaign from this segment" link drops the segment → all-consented broadcast (critic M16) | CODE-TRACED |
| AUTO-38 | Cross-Sell "Send education / Invite / Remind" buttons; Lapsed-Life "AI outreach" panels | /app/cross-sell, /app/winback | button → `api/cross-sell/[id]/route.ts:53-55` (activity only) | — | activities | none | — | — | — | — | activity | **DISPLAY-ONLY** (E-17/E-18) | CODE-TRACED |

### 2.5 AI workforce (orchestrator and remaining roster)

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-39 | workforce-orchestrator (build + dispatch) | /app/ai command center | `0 15 * * *` → `h.ts:366` → `wf.ts:532` | daily; dispatch only inside `comm_hours_policy` | `outreach_queue`, `agent_runs` | `buildQueue :286`, `runOutreachAgent :352` | yes | chokepoint | queue status never reflects delivery (F-12) | kill switches `agent-runner.ts:63-69` | — | **PARTIAL** — queue dedupe per UTC day (F-11/I-08); claims stuck `drafted` on error (F-10). PROD: runs daily, **builds 0 items** because member consent is read from `consents` (0 rows) — blocked as designed | PROD-AGG; TEST-COVERED ✓ `workforce` |
| AUTO-40 | **referral_followup workforce agent** | /app/ai "Active"; /app/referrals | `wf.ts:236-262` (status received/working, `first_touch_at` null) | daily | `outreach_queue` | `wf.ts:352` | MARKETING | chokepoint | — | **send never sets `first_touch_at`** (`wf.ts:499-502`) | — | **BROKEN (P0)** — legacy rows re-messaged daily (H-01/I-01); **new referrals never contactable** (household null until conversion; F-06/H-05). PROD: 5 candidates, 0 with household | PROD-AGG; CODE-TRACED |
| AUTO-41 | "Run workforce now" | /app/ai | browser click → `api/app/ai/workforce/run/route.ts:20` | manual | `outreach_queue` | same | yes | — | — | same | — | **PARTIAL** — manual run before 15:00 UTC consumes the day's dedupe key and starves the cron (I-08); after 00:00 UTC sends a second batch the same Chicago day (F-11). Cron path exists, so not UI-dependent | CODE-TRACED |
| AUTO-42 | Other roster agents | /app/ai roster | executive_intelligence (on demand, draft-only); contact_router (no `ai_agents` row → fails closed); content_drafter (draft-only); engagement_triager (no ingestion — display-only); compliance_guardrail (toggle display-only, gate always runs); data_quality/commission_reconciliation (cron jobs, flag unread); agency_activation/referral_triage (routing labels); agency_growth/case_management/document_intelligence (roadmap) | — | — | — | — | — | — | — | — | **DISPLAY-ONLY / DRAFT-ONLY / PLANNED** — roster and command center show them "Active/On/Working" from config flags (F-14, F-15, I-11, I-12, I-13) | CODE-TRACED; PROD-AGG (all enabled) |

### 2.6 Appointments, workshops

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-43 | Booking confirmation / reschedule / cancel / recap / no-show notices | /app/booking notifications | `book.ts:307` → `notify.ts:485`; `manage.ts:212`; `service.ts:97-109` | inline + `*/15` SMS retry pass `notify.ts:756` | `booking_notification_deliveries` (unique leg) | `deliverLeg` `notify.ts:392-470` | yes (APPOINTMENT purpose) | chokepoint | comm_messages only (G-13) | ledger fire-once | — | **PARTIAL** — PROD: 0 ledger rows ever. SMS legs return `sms_a2p_hold` before claiming (`notify.ts:397-401` ✔, A2P flag ASSUMPTION off); email legs need a booking-email consent record (none) and approved email templates (none — fallback is transactional ack). Household securities flag blocks all notices (G-06, policy Q) | TEST-COVERED ✓ `booking-sms-lifecycle`, `booking-notify`; ◇ `booking-delivery-ledger`; PROD-AGG |
| AUTO-44 | Booking reminders (24h configured; code default 24h/12h/1h) | same | `vercel.json` `*/15` → `cron/booking-reminders/route.ts:36` → `notify.ts:573` | every 15 min | computed each tick from `appointments.starts_at` | `runBookingReminderPass` | yes | chokepoint | comm_messages only | status must be `scheduled`; reschedule re-keys by `schedule_version` | — | **PARTIAL** — same dependencies as AUTO-43; review-created appointments have `starts_at` null → never reminded (critic M8); reaper can re-send a delivered-but-unsettled leg (G-09). DST Nov 2 2026 09:00 Chicago → 24h reminder at 2026-11-01T15:00Z ✔ correct (G case) | TEST-COVERED ✓ `booking-notify-events`; ◇ `booking-reminder-idempotency` |
| AUTO-45 | Booking stops prospecting | — | `book.ts:235-252` → `exitOnAppointment` (xsell, life, winback) | inline, public booking only | enrollment tables | — | — | — | — | **not called** from FSA review scheduling (`api/reviews/route.ts:64-67`); no effect on drips, workforce queue; rechecks key on `appointments.household_id` (null on native bookings, G-02) | enrollment exit when `contacts.household_id` set | **PARTIAL (P0 for Life Conversion + workforce)** D-02/I-02/G-01/G-02 | TEST-COVERED ✓ `pipeline-winback-booking-exit` |
| AUTO-46 | Workshop reminders, change notices, nurture, registration ack | /app/workshops | `vercel.json` `*/15` → `cron/workshop-reminders/route.ts:34` (**Bearer `CRON_SECRET` only**) → `comms-engine.ts` passes; registration inline `public/workshops/register/route.ts:298` | every 15 min | `workshop_message_log` (claim unique) | `sendWorkshopMessage` `comms-engine.ts:316-522` | yes (TRANSACTIONAL / WORKSHOP) | chokepoint | comm_messages only | cancelled sessions/registrations excluded; quiet hours treated as retry | — | **PARTIAL** — PROD: 0 log rows ever (cron auth or kill switch: UNKNOWN); config read error → kill switch fails open (G-07); durable consent overrides recorded revokes (G-08 P0, policy Q); stranded `sending` claims never reaped (G-14) | TEST-COVERED ✓ `workshop-engine-invocation`; ◇ `workshop-guarantee-*` |
| AUTO-47 | No-show recovery tasks | /app/appointments | manual POST `/api/app/appointments/recovery` | manual | `work_tasks` | human | — | — | — | — | task | **DRAFT-ONLY** (by design) | TEST-COVERED ✓ `appointment-recovery` |

### 2.7 Referral, district nurture, social, detection jobs

| # | Automation | UI surface | Trigger | Schedule | Queue / state | Consumer | Gate | Provider | Callback | Stop conditions | Furthest link | Status | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUTO-48 | referral-sla escalation | /app/ai/escalations | `0 * * * *` → `h.ts:83` | hourly | `agent_actions` | human | — | — | — | one per referral (hard-delete of escalation re-arms it, critic M13) | escalation row | **DETECTION-ONLY** (by design) | PROD-AGG (5 breached) |
| AUTO-49 | Public referral intake `/api/public/refer` | public form | `route.ts:16` | event | referrals | AUTO-48/40 | — | — | — | — | insert **fails**: `owner_scope='public'` into `uuid` | **BROKEN** (H-03; live column type confirmed `uuid`) | PROD-AGG (schema) |
| AUTO-50 | Partner / legacy `/[slug]` referral + questionnaire email | partner portal, agency page | `partner/refer/route.ts:14`; `agencies/referral/route.ts:27` → `forms.ts:57` | event | referrals; `agency_referrals` (no consumer) | none / inline email | email gated on referred person's own consent | Resend | — | — | gate consent block (correct) | **PARTIAL** — legacy rows never reach the spine (H-04); success copy promises an email the gate blocks; no first-touch task (H-17) | TEST-COVERED ✓ `agency-intake-hardening` |
| AUTO-51 | District nurture ("The Second Conversation") | /app/comms/district-nurture | `0 14 * * *` → `h.ts:447` → `district-nurture/tick.ts:53` | **14:00 UTC = 09:00 CDT / 08:00 CST** | `district_nurture_enrollments/executions` | `tick.ts:81-155` | MARKETING, memberId null | chokepoint | comm_messages only | agent's own reply never pauses (B-11/H-06); any open client thread under the agency pauses it indefinitely (H-07) | gate | **DISABLED** (draft). Code **BROKEN**: 14:00 UTC is 08:00 under the fixed −6 business hours → deferred every run (A-06/H-08); after Nov 1 SMS hits terminal quiet hours | TEST-COVERED ✓ `district-nurture-*` |
| AUTO-52 | social-publish | /app/social | `*/5` → `cron/social-publish/route.ts:24` → `publisher.ts:43` | every 5 min | `social_schedule_entries` | conditional claim | n/a (not client messaging) | platform APIs | — | cancel entry | platform post | **PARTIAL** — publishes to a disconnected/revoked channel (H-10); no lease on `publishing` (H-12). PROD: 0 entries | TEST-COVERED ✓ `social-schedule` |
| AUTO-53 | renewal-watch, xdate-watch | /app/tasks | `0 9 * * *` → `h.ts:20,37` | daily | `work_tasks` | human | — | — | — | **lifetime dedupe per policy** — next year's renewal never re-tasked (H-16) | task | **DETECTION-ONLY** | PROD-AGG |
| AUTO-54 | agency-dormancy, commission-reconcile, data-quality | /app/agencies, commissions | `vercel.json` → `h.ts:98,115,380` | daily | `agency_partnerships`, `commissions`, contacts | — | — | — | — | — | state write | **OPERATIONAL-IN-CODE** (no sends; data-quality grows the enrollable population, critic M21) | PROD-AGG |
| AUTO-55 | backup-verify | /super/backups | `0 3 * * *` → `h.ts:487` | daily | `audit_log`, `activities` | — | — | — | — | — | heartbeat | **PARTIAL** — claims "restore-test heartbeat", verifies nothing (H-14) | PROD-AGG |
| AUTO-56 | pg_cron `fsos-nightly-scoring` | — | `001_initial_schema.sql:887-891` | 08:00 UTC (DB) | scores | `run_nightly_scoring()` | — | — | — | — | — | **OPERATIONAL-IN-CODE** (active in prod; no sends) | PROD-AGG |

### 2.8 UI-only automation, dead paths, external, voice

| # | Automation | UI surface | Trigger | Status | Evidence |
|---|---|---|---|---|---|
| AUTO-57 | Automation Workflows builder (8 trigger types, "enabled" toggle) | /app/workflows | **no executor**; `automation_runs` never written | **DISPLAY-ONLY** (I-04/J-04). PROD: 0 enabled | CODE-TRACED; PROD-AGG |
| AUTO-58 | Scheduled reports ("delivered by Vercel Cron") | /app/reports/scheduled | none in `vercel.json` | **DISPLAY-ONLY** (J-05). PROD: 0 enabled | CODE-TRACED |
| AUTO-59 | Outbound webhooks | /super/webhooks | no emitter writes `webhook_deliveries` | **DISPLAY-ONLY** (I-23/J-13) | CODE-TRACED |
| AUTO-60 | "Failed sends retry idempotently" | /app/comms/delivery | no consumer | **DISPLAY-ONLY** (I-18) | CODE-TRACED |
| AUTO-61 | Data-export queue ("Vercel Cron worker builds the file") | /admin/data/exports | none | **DISPLAY-ONLY** (critic M14) | CODE-TRACED |
| AUTO-62 | Document-request client notification ("routes through the comms gate") | /app/documents | none | **DISPLAY-ONLY** (critic M15) | CODE-TRACED |
| AUTO-63 | Legacy drip runner `/api/campaigns/run` | — | manual internal-auth POST only | **DISCONNECTED** (send-capable; J-12) | CODE-TRACED |
| AUTO-64 | `agent-runner` `ctx.send` | — | no caller | dead code (`runAgent` itself is live) | CODE-TRACED |
| AUTO-65 | Zoom attendance webhook → workshop nurture + spine | — | `webhooks/zoom/route.ts:34-111` | **OPERATIONAL-IN-CODE**; returns 200 on handler error | CODE-TRACED (critic M1) |
| AUTO-66 | Console AI opener arms auto-reply | inbox | `comms/conversations/start/route.ts:107,141` | **OPERATIONAL-IN-CODE** (operator-initiated) | CODE-TRACED (critic M23) |
| AUTO-67 | Off-repo senders: Make.com scenarios S1–S4, GHL WF-0..43, Supabase Auth mailer | — | `docs/make_scenarios.md`, `docs/ghl_integration.md` | **UNKNOWN** (cannot verify from repo; potential senders outside the chokepoint) | CODE-TRACED (docs) |
| AUTO-68 | **Voice / outbound calls** | — | none (`RETELL_API_KEY` reserved, `.env.local.example:98-100`) | **PLANNED / NOT BUILT** — inventory only, out of completion scope | CODE-TRACED |

## 3. Bidirectional diffs

**Handlers vs scheduler.** All 24 `vercel.json` crons resolve: 21 via `JOBS` (`src/jobs/index.ts`), 3 static routes.
Registered but unscheduled: `agent-runner` (alias of `workforce-orchestrator`, `index.ts:46`). Exported but not a job:
`dripAdvance` (reached only via `campaign-dispatch`). Scheduled-in-copy but absent from `vercel.json`: morning briefing
(AUTO-15), scheduled reports (AUTO-58), data exports (AUTO-61). `/super/jobs` lists a hard-coded 10 jobs (I-10).
`tests/cron-activation.test.mjs` checks only `vercel.json → JOBS` (J-15).

**Emitted events vs subscribers.** `EVENT_DRIVEN_SMS` (5 triggers) and every playbook follow-up/handoff/closing field:
displayed, no subscriber (AUTO-28/29). `WEBHOOK_EVENTS`: configurable, never emitted (AUTO-59). Automation Workflows
trigger types (`referral_received`, `conversion_window`, `policy_x_date`, …): no subscriber (AUTO-57). Provider callbacks:
subscribed only by `comm_messages`; no engine execution/enrollment reads them (B-10, D-12, G-13). Email unsubscribe emits
no ledger event (C-14).

**Queue/state tables vs consumers.** Writer, no consumer: `activities(conversion_identify)`, `activities(crosssell_identify)`,
`agency_referrals(new)`, `comm_audiences`, `automation_workflows/runs`, `scheduled_reports`, `webhook_deliveries`,
`data_exports`, `xsell_life_campaign_enrollments.future_follow_up_at`, `*_advisor_touches` (escalate/reassign/hold never
evaluated: D-16, E-12, H-19), gate-block recovery queues (`comm_assignment_reviews`, AI escalations: resolve only, never
re-send — critic M13). Consumer that never re-sends: every `*-retry` sweep (AUTO-24/30). Rows never expired:
`outreach_queue` from past days (E-19).

**Templates vs workflows.** Booking SMS `appointment-*-sms` (6) referenced by `notify-events.ts:39-46` and approved;
booking **email** source keys referenced but **no approved rows in production**. 116 approved templates carry no
`source_key` (campaign/manual use). Most `src/emails` registry entries are unreferenced by any workflow (C-14).
`EVENT_DRIVEN_SMS` bodies are code constants, not templates.

**UI "active" indicators vs server paths.** Command Center "Working now" and roster "Active/On" come from
`ai_agents.enabled`/`agent_daily_targets` flags, not execution (F-15, I-11) — production shows all 16 agents enabled while
`agent_runs` is empty since 2026-08-13. Campaign hub "Currently dispatching" from `comm_campaigns.status` (C-13, I-05).
Campaign health panel renders every successful run amber and loses failed runs (I-06); Cross-Sell health turns query errors
into 0 = "Healthy" (I-07). System Health/Integrations report "connected" from env-var presence (I-24). The UI automation
lists are **hard-coded** (roster metadata `src/lib/ai/roster.ts`, `/super/jobs` array, playbook constants) — part of the
#265 defect class.

## 4. Case matrix (brief §AUTONOMOUS SMS / EMAIL / APPOINTMENTS)

| Case | Expected | Code today | Verdict |
|---|---|---|---|
| Normal SMS delivery | SID stored; status only forward; next step | SID patched after dispatch; late `sent` cannot downgrade; post-send patch can overwrite a faster `delivered`; late `delivered` overwrites `bounced/failed`; next step never driven by callback | PARTIAL |
| Invalid number / permanent rejection | failed, not retried, number flagged | sync 400 recorded `blocked` with null step; no number flag; later touches continue | FAILS |
| Temporary failure | bounded retry, same idempotency key, gate re-run | no provider idempotency key; no retry anywhere; retry sweeps only bump counters | FAILS |
| No consent | blocked, reason recorded, Twilio never called | as expected (`gate.ts:277`) | MEETS |
| STOP | suppression; pending canceled; one confirmation | DNC + revoke; 4 tables terminated for one member; FSOS sends no STOP reply (relies on Twilio) | PARTIAL |
| 21610 | permanent, suppression, never retried | async callback ✓; synchronous 21610 writes nothing | PARTIAL |
| Quiet hours (local, DST Nov 1 2026) | recipient-local | Window 09:00–20:00 (`guardrail.ts:66-68` ✔), Intl-based (DST-correct) — but default mode evaluates **everyone in America/Chicago** (`QUIET_HOURS_RECIPIENT_LOCAL` off); floor applies only to MARKETING-class SMS; business hours use fixed −6 | PARTIAL / POLICY |
| Duplicate dispatch / overlapping cron | one provider call | hour-bucket job lock + per-touch unique claims; **drip has no per-step claim**; no provider idempotency key | PARTIAL |
| Duplicate / out-of-order / forged callback | idempotent, monotonic, forged rejected | forged/unsigned rejected (HMAC, svix) ✓; duplicates re-apply timestamps; replayed Resend payload accepted (no tolerance) | PARTIAL |
| Worker crash mid-batch | lease released, no double send | job lease 15 min; booking reaper (may double-send); broadcast/workforce/tick claims never released | PARTIAL |
| Suppression/booking/reply after scheduling | step canceled before dispatch | reply/STOP: per-member; booking: public booking + 3 engines only; workforce: none | FAILS |
| Shared number | right thread, right enrollments | one arbitrary member (no ORDER BY, sticky) | FAILS |
| Resend delivered/bounced/complained | ID stored, state, suppression | as expected | MEETS |
| Resend suppressed@ | — | no mapping for a `suppressed` event (Resend payload not verified) | UNKNOWN |
| delivery_delayed | never regresses | mapped to `sent`, blocked by terminal | MEETS |
| Unsubscribe / List-Unsubscribe | suppression; marketing blocked; transactional per policy | DNC blocks **all** email incl. appointment reminders; header on every email | POLICY |
| Inbound email reply | same stops as SMS | same handler; provider wiring unverified | PARTIAL |
| Booking stops prospecting | all engines | partial (AUTO-45) | FAILS |
| Reschedule / cancel reminders | re-time / remove | recomputed per tick from current `starts_at`; `schedule_version` re-key ✓; cancel excludes ✓ | MEETS |
| Reminder DST (Mon 2026-11-02 09:00 CT) | correct | 24h → 2026-11-01T15:00Z = 09:00 CST ✓ (12h lands 21:00 — appointment SMS exempt from floor, policy Q) | MEETS / POLICY |

## 5. Verified defect register

Severity after adversarial verification. P0 = can send when it should not / stop condition broken; P1 = disconnected or
missable deadline; P2 = status/callback/retry truth; P3 = UI/docs. Full claims, evidence and verifier notes are kept in
the workflow journal; this register is the working list.

### P0 (19 verifier-confirmed claims → 12 distinct defects)

| ID | Defect | Key evidence | Repair class |
|---|---|---|---|
| A-02 / B-01 | DNC, consent-revoke, durable-consent and household-securities readers **fail open** on a Supabase `{error}` (supabase-js does not throw) | `contact-consent-read.ts:127-149` ✔, `:72-119`; `dp.ts:262-269, 375-391`; `conversations.ts:91-105` | (a) tighten — code contradicts its own "fails SAFE" contract |
| A-03 / E-01 / H-02 | Frequency caps and min-interval count only `delivery_status='sent'`; delivered rows drop out | `policy-resolver.ts:112-113,121` ✔; `events.ts:54-60` | (a) tighten |
| A-04 | Default quiet-hours mode evaluates every recipient in America/Chicago; unresolved zone never blocks | `dp.ts:186-189, 449-455`; pinned by `tests/dispatch-chokepoint.test.mjs:44-67` | **gate-policy Q** (env flag) |
| B-02 | First-word `yes`/`subscribe`/`start` creates channel consent and deletes internal DNC (incl. bounce/complaint/unsubscribe) | `keywords.ts:9,12-17` ✔; `inbound.ts:251-262` ✔ | **gate-policy Q** (recommend: bare keyword, restore-only) |
| B-04 | Shared phone/email: one arbitrary member linked; stop conditions applied to that member only | `conversations.ts:47-71,148-160`; `inbound.ts:396-397,460-461,484-485` | (a) tighten — apply stops to every matching member |
| D-01 | Life Conversion ignores business suppression (POLICY_DEADLINE classed transactional) | `suppression.ts:39-46,71-76`; `dp.ts:558-567`; `tick.ts:308` | **gate-policy Q** + tick backstop |
| D-02 / I-02 | FSA-scheduled review appointment does not stop Life Conversion; recheck has no appointment input | `api/reviews/route.ts:64-67`; `book.ts:231-249`; `eligibility.ts:26-43` | (a)/(b) stop condition |
| D-03 / F-01 / E-02 | Workforce re-messages the same targets every day (dedupe per `queue_date` only) | `wf.ts:286-317`; `034_ai_workforce.sql:77` ✔ | (a) stop condition |
| F-02 | Benign reply, booked appointment, converted policy do not stop workforce outreach | `inbound.ts:101-138`; `wf.ts:286-332`; `policy-resolver.ts:154-172` | (a) |
| F-03 | Natural-language stop reaches the workforce only if a contact id resolves | `inbound.ts:211-237`; `wf.ts:118-126,441-445` | (a) |
| G-08 | `durableConsentGranted` overrides recorded revokes with no DNC row (workshop SMS, booking email) | `dp.ts:520-524,549-552`; `comms-engine.ts:397,505` | **gate-policy Q** (recommend revoke-aware) |
| H-01 / I-01 | referral_followup never marks the referral touched → new "first touch" daily | `wf.ts:236-245,499-502`; `api/referrals/[id]/route.ts:53-55` | (a) |

### P1 (44 confirmed) — grouped

- **Cron timing vs gate windows:** campaign-dispatch 12:00 UTC burns SMS and holds email forever (A-05, C-02, I-05, J-02);
  district-nurture 14:00 UTC deferred daily, terminal after DST (A-06, H-08, J-03). Schedule change = hard stop;
  hold-vs-burn on `quiet_hours` = policy Q.
- **Cron auth:** `x-vercel-cron` header trusted by `[job]`, booking-reminders, social-publish (A-01, C-07, J-01;
  `[job]/route.ts:14-21` ✔). Fix requires confirming `CRON_SECRET` is provisioned, else every cron 401s.
- **Inbound handling:** genuine replies starting Yes/Help/Start skip pause (B-03); callbacks never reach engine state;
  permanent failures do not stop cadences (B-10); district nurture pause mis-wired (B-11, H-06, H-07); wrong-number/deceased
  never applied (B-12); STOP can be lost on partial processing (B-13); suppression writers ignore `{error}` (B-14).
- **Native campaigns:** drip unreachable and silently completes enrollments (C-01); no booking/conversion/
  `do_not_contact` stop (C-03, latent); kill switch ignored (C-05).
- **Term conversion:** sweep starvation + duplicate tasks (D-04); A2P hold freezes whole cadence (D-05); lapsed/converted
  policies keep receiving touches (D-09); term_conversion quota starvation (F-07).
- **Win-back / cross-sell:** recipient switch between build and dispatch (E-03/F-04); playbook follow-ups displayed but
  never sent (E-05); Win-Back self-pause (E-06); invalid Cross-Sell purpose (E-07); no cross-workflow precedence (E-08);
  no first-message sender identification for workforce (F-05).
- **Referrals:** referral_followup structurally can't reach new referrals (F-06, H-05); public intake insert fails (H-03);
  legacy `/[slug]` referrals stranded (H-04).
- **Appointments:** booking stop not applied to drips/workforce/review-created appointments (G-01); cross-sell/win-back
  rechecks miss native bookings (G-02); booking SMS opt-in satisfies marketing for non-members (G-04, policy Q);
  household securities flag blocks all appointment notices (G-06, policy Q); workshop kill switch fails open (G-07).
- **Social:** publishes to a revoked channel (H-10).
- **UI-only automation:** workflow builder has no executor (I-04, J-04).

### P2 / P3 (128) — tracked, compact

P2: provider error classification and idempotency (A-07, A-10, B-05, B-06), status regression/race (A-11, B-07, B-08),
fixed-offset business hours (A-12, J-11), crash/lease gaps (A-13, F-10, G-14, J-08, H-12), retry sweeps that never re-send
(D-07, E-10, H-11, J-06), runIdempotent erasing failures (J-07, H-15), drip claim race (C-08), broadcast lifecycle (C-11),
swallowed dispatch errors (C-12), booking reaper/retry churn (G-09–G-12, G-16, G-17), resume catch-up bursts (D-08, E-11),
UTC-day queue key (F-11, I-08), workforce class hard-coded (F-09), multiple paths same purpose (F-08), Resend replay/
unmapped events (B-17, B-18), email CANCEL global opt-out (B-19), email DNC case-sensitivity (A-09, B-15), and others.
P3: UI truth (C-13, E-16–E-18, F-15, F-16, I-06, I-07, I-09–I-24), docs drift (A-18, J-14), legacy paths (J-12).
Refuted: B-20, I-19, I-20.

## 6. Gate-policy questions (owner decisions — code left as is until answered)

1. **Quiet-hours locality.** `QUIET_HOURS_RECIPIENT_LOCAL` defaults off (Chicago for everyone; unresolved zone never blocks)
   vs CLAUDE.md "recipient-local, unresolved = hard block". What is the production value, and which governs?
2. **Quiet-hours scope.** The 09:00–20:00 floor applies only to MARKETING/WORKSHOP/BIRTHDAY/RELATIONSHIP or purposeless SMS
   (`purpose.ts:85-89`). Life Conversion and term_conversion (`POLICY_DEADLINE`), appointment SMS (12h reminder lands
   overnight), servicing/transactional are exempt. Should automated campaign SMS of any purpose keep the floor?
3. **Hold vs burn.** `quiet_hours` is terminal (campaign touches burned, broadcast recipients suppressed) while workshops
   treat it as a hold. Should campaign schedule owners hold the touch for the next window? (Nothing sends either way.)
4. **START/YES.** Should conversational "Yes…" ever create consent? Recommend: bare keyword only, restore a keyword-revoked
   state only, never delete bounce/complaint/unsubscribe DNC rows.
5. **Durable consent vs revoke.** Should `durableConsentGranted` honour a recorded revoke (G-08)? Recommend yes.
6. **POLICY_DEADLINE classification.** Is a 20-touch "book a free review" cadence servicing or marketing — for consent
   purpose, business suppression, collision and the quiet-hours floor (D-01, F-term_conversion)?
7. **Contact-level consent scope.** A booking customer-care SMS opt-in (no purpose column) satisfies MARKETING for
   non-member recipients (G-04, E). Should `comm_contact_consents` be purpose-scoped?
8. **Consent store promotion.** Live consent sits in `comm_contact_consents` (9 rows) while member-keyed `consents` is empty;
   members resolve to `consents` only. Should captured contact consent be promoted to the member? (Today the workforce
   and campaigns reach nobody.)
9. **Consent-population backfill** grants SMS+email to every member lacking a revoke/DNC row (absence of opt-out = consent).
   Has it been run, and on what basis?
10. **Securities flag scope.** Any `is_security` household policy blocks every send to the household incl. appointment
    notices; CLAUDE.md says per opportunity/case/communication only.
11. **Email unsubscribe vs transactional.** Email DNC blocks all email incl. appointment reminders and password setup;
    List-Unsubscribe is on every email. Documented transactional policy?
12. **HELP/STOP reply ownership** with Twilio Advanced Opt-Out (avoid double HELP; FSOS sends no STOP confirmation).
13. **Permanent SMS failure codes** (21211, 21614, 30003–30008): suppress/flag the number without revoking consent?
14. **Wrong number / deceased** replies: end automation in every engine and flag the number?
15. **Natural-language stop:** revoke marketing-purpose consent (so every path stops) or keep business suppression only?
16. **AI approved-template standard:** "agent enabled" currently satisfies `approved_template` for free-form AI drafts —
    the approved-template rule never blocks an AI draft. Acceptable, or must AI first-touch use approved templates?
17. **First-message sender ID:** identity disclosure fails open when no identity ctx is passed (drips, workforce). Mandatory?
18. **Canonical paths & precedence:** term conversion = Life Conversion vs term_conversion agent; cross-sell = Cross-Sell Life
    vs cross_sell agent vs `cross_sell` comm_campaign audience; win-back = Pipeline Win-Back vs life_winback agent. Which is
    canonical and should the others stand down for enrolled contacts? Cross-workflow frequency cap?
19. **Cross-Sell Life purpose** seeded `CLIENT_CARE_CROSS_SELL` (invalid). Intended purpose?
20. **`households.do_not_contact`** is not a gate input (only audience/eligibility filters). Should the gate enforce it,
    and should inbound STOP set it?
21. **Referral consent provenance:** may a referrer's attestation ever support a `consents` grant at conversion?
22. **Business hours fixed −6 offset** (one hour off during CDT). Switch to `America/Chicago`?
23. **Template approval by migration** (135 auto-approved booking SMS) — satisfies human review?
24. **Bulk campaigns with non-marketing purposes** (SERVICING/APPOINTMENT remove the SMS floor) — allowed?
25. **District nurture consent basis** for agency owners (no capture path exists; every touch consent-blocks).
26. **Frequency resolver fails open** on a count error (`policy-resolver.ts:138-142`) vs documented fail-closed.

## 7. Out-of-scope findings (recorded, not acted on)

- **Legacy AI FNA auto-generation** (`forms/submit/route.ts:88-97` → `lib/fna.ts`) emits `recommendations[]` with product
  categories (incl. annuities/IRA/mutual funds) and a risk profile with no red-line screen — AI red-line / securities
  question for the owner.
- **DB trigger `form_submission_profile_sync`** (`001_initial_schema.sql:807-865`) writes Conservative/Moderate/Aggressive
  risk labels — suitability-adjacent.
- Public referral route returns raw Postgres error text to anonymous callers (H-03 note).
- Unauthenticated open/click tracking endpoints write events for any message UUID (critic M20).
- `scripts/reset-campaigns.mjs --apply` flips Cross-Sell Life back to active and restarts contacts at touch 1 (critic M22).
- Supabase branching integration `MIGRATIONS_FAILED`; migration ledger out of sync with repo (14/139).
- Skill drift: `twilio-a2p-compliance` and `fsos-deliverability` still describe the retired `sendThroughGate` path and a
  7-step gate.
- Orphan Resend events (116) — sender unidentified without Resend/Vercel access.

## 8. Tooling and skills

Used: using-superpowers, systematic-debugging, fsos-crm-workflows, twilio-a2p-compliance, fsos-security-audit,
fsos-deliverability, workflow-authoring (Workflow tool). To load at repair time: writing-plans, test-driven-development,
fsos-testing, supabase, supabase-postgres-best-practices, fsos-email-template-qa, frontend-design, impeccable,
verification-before-completion, requesting-code-review. **Not installed:** fsos-outbound-consent-gate,
fsos-financial-compliance-firewall, fsos-data-security. MCP `supabase`/`twilio`/`graphify` from `.mcp.json` require auth
(unavailable); the claude.ai Supabase connector was used read-only.

## 9. Checkpoint package (presented 2026-10-02, awaiting approval)

Repair plan: `docs/superpowers/plans/2026-10-02-automation-e2e-repair.md` (25 tasks; brief order a→e).

**Backlog and stale-row policy for every consumer the plan would connect or move server-side** (production, 2026-10-02):

| Consumer (switch) | Pending rows today | Age | Proposed stale-row policy |
|---|---|---|---|
| Callback → engine state (`callback_engine_state`) | 0 engine executions in all four engines | — | Act only on callbacks received after the switch leaves `off`; never re-process history. |
| Native drip advance (`native_drip`) | 0 `comm_sequences`, 0 `comm_campaign_enrollments` | — | On first enable, any `enrolled` row with `next_send_at` older than 7 days → `expired` (not sent, not deleted). |
| Engine retry re-dispatch (`engine_retry_redispatch`) | 0 executions in `scheduled`/retry state | — | Re-dispatch only claims < 24h old whose enrollment is still live and whose window/appointment has not passed; older → `dead_letter`. |
| Workforce stand-down + recipient pinning (tightening only) | `outreach_queue` 0 rows (0 past-dated `queued`) | — | Past-date `queued` rows → `skipped`/`stale_queue_date` at each build (E-19). |
| Appointment-booked fan-out (tightening only) | 6 appointments still `scheduled` with past start (oldest 2026-08-04) | ≤ 59 d | Report only — completing vs no-show is the FSA's call; the reminder pass already ignores past starts. |
| referral_followup (would only reach referrals with a linked household) | 5 untouched referrals, 0 with household | oldest 72 d | Never auto-first-touch a referral older than 14 days; route to the FSA task list instead. |
| Workshop engine (if `CRON_SECRET` is provisioned and the route starts running) | 0 registrations awaiting nurture for past sessions | — | Nurture only within `replay_window_days` of session end (existing config). |

All proposed actions are status changes written by a script on the branch and run by the owner at deploy — no deletes.

**A2P throughput.** No pacing exists today (J-10): sends are sequential per tick with no rate limit; Twilio 429 is
handled as a generic failure. Volume today is near zero. The plan keeps ticks sequential and per-run caps as they are;
pacing to the registered campaign's MPS is a follow-up the owner can approve once the A2P campaign tier is confirmed.

**Production canary checks (post-deploy; no non-production environment exists).** Prerequisites: the owner verifies the
canary SMS number and email as `comms_test_recipients` through the existing `/app/comms` test-recipient flow (0 verified
today), and reads `SMS_A2P_APPROVED`, `QUIET_HOURS_RECIPIENT_LOCAL`, `CRON_SECRET`, `TWILIO_MESSAGING_SERVICE_SID` (names
only) in Vercel.

| # | Check (makes LIVE-VERIFIED) | Records to create | Trigger / your action | Switch state | Expected FSOS evidence |
|---|---|---|---|---|---|
| C1 | SMS chokepoint + status callback | none beyond the verified canary | console test send to canary SMS | n/a (console) | `comm_messages` row with `provider_id` (SID), `sent`→`delivered`; `comm_message_events` correlated |
| C2 | Email chokepoint + Resend webhook | none | console test send to canary email | n/a | Resend id stored; `delivered` event correlated |
| C3 | STOP | canary household member with SMS consent | you text **STOP** from the canary | n/a | DNC row; consent revoked; next test send blocked at `dnc`; exactly one opt-out confirmation received (Twilio's) |
| C4 | Reply pause | canary member enrolled in a campaign under `canary` | you reply "sure, when?" | engine switch `canary` | enrollment `paused_for_conversation`; FSA escalation; no further touch |
| C5 | One-click unsubscribe | canary email recipient of a marketing send | you click the unsubscribe link | n/a | email DNC; next marketing email blocked at `dnc` |
| C6 | Bounce / complaint suppression | none | test sends to `bounced@resend.dev`, `complained@resend.dev` | n/a | DNC rows written from the webhook |
| C7 | Booking confirmation + reminder + reschedule + cancel | canary books via `/schedule` 25 h ahead with SMS opt-in + email consent | reschedule once, then cancel | `booking_reminder_config` as is; requires A2P approved + approved email templates | ledger rows `sent`; reminder at T-24h; old-version reminder not sent; none after cancel |
| C8 | Booking stops prospecting | canary enrolled (canary state) in Life Conversion | book an appointment | engine `canary` | enrollment `exited` / `appointment_booked` |
| C9 | Workforce first touch, once | canary household with a coverage gap + member SMS consent | wait for the 15:00 UTC run | agents are already enabled for everyone in prod (as found) | one `outreach_queue` `sent` row; **no second invite the next day** (Task 4) |
| C10 | Callback → engine state | canary enrollment | — (permanent-failure branches are mock-only; a real number cannot produce 21610 on demand) | `callback_engine_state` `canary` | PARTIAL: only the `delivered` branch is live-verifiable |

## 10. Checkpoint decisions (owner, 2026-10-02)

Plan approved as presented, with these changes. Values the owner's reply left as unfilled placeholders are recorded
as **UNANSWERED**; nothing is inferred for them.

| # | Decision |
|---|---|
| 1 | Quiet hours are **recipient-local by code default** (no env dependence). Zone from the contact's address, then the phone's area code. If neither resolves: send only at times inside the 09:00–20:00 floor in **every continental US zone** (ET/CT/MT/PT). Production value of `QUIET_HOURS_RECIPIENT_LOCAL`: **UNANSWERED** (placeholder). |
| 2 | The floor covers **all automated campaign SMS**, Life Conversion and term conversion included. Marketing SMS also held until **12:00 recipient-local on Sundays** (Texas solicitation hours; counsel to confirm). Appointment reminders respect the floor (see 3). |
| 3 | **Marketing: hold**, not skip. On release re-run the gate and stop conditions, spread releases within A2P throughput, expire anything still held after **72 h** with the reason recorded. **Reminders do not hold**: a reminder landing in quiet hours moves to the nearest allowed time still before the appointment, or is skipped if none exists. |
| 4 | START/YES: only a **bare keyword** counts; it only **restores a keyword opt-out**, never creates consent. **Never delete** DNC or consent rows; record the re-opt-in as a new event. |
| 5 | The **most recent revoke wins** over durable consent until a newer, documented opt-in. |
| 6 | Life Conversion is **marketing** for consent, suppression and quiet hours. Counsel question logged: can a deadline notice with no product pitch be servicing? |
| 7 | **Campaign engines own** automated sends for term conversion, cross-sell and win-back. Workforce agents do not send to those audiences (reuse an existing hand-off-to-enrollment hook only if one exists; don't build one). A workforce first touch is **one-time per target per workflow, recorded durably**. Report must note this differs from operating documentation that routes these through `term_conversion` / `marketing_automation`. |
| 8 | `campaign-dispatch` and `district-nurture-tick` move to **17:00 UTC** (inside the floor in every continental zone year-round), or hourly if the Vercel plan allows. |
| 9 | Cron routes **require `CRON_SECRET`** (approved). Production status of `CRON_SECRET`: **UNANSWERED** (placeholder: "set \| not set, and I'll add it before merging"). Merge is blocked on it being set. |
| 10 | Cross-Sell Life purpose = **marketing**: the valid purpose with full marketing treatment at the gate (strictest if several fit). |

Additions:

- Any repair that lets a path send where it cannot today ships **behind the new switch, off** — including the agents'
  consent lookup.
- The 143 open threads are backlog; nothing advances them on deploy. Propose a disposition before Win-Back is unpaused.
- No automated contact for any referral older than 14 days; the 5 are listed for FSA follow-up in the report (no task
  mechanism).
- The 6 past-dated appointments: report only; the owner updates them.
- The other gate-policy questions in §6: code left as is; listed in the report.
- `SMS_A2P_APPROVED` production value: **UNANSWERED**. Report lists everything that would send SMS if it were on.
- Unmatched Resend sender: **UNANSWERED**; if it reaches clients it is P0 and goes through the gate.
- Report how production was read (see below) and whether that path can write.
- If Supabase Preview creates a branch database once the PR carries migrations, report what Vercel Preview uses for
  database and provider keys; flag any reach to production data or live keys; propose an isolated DB for E2E.
- Optional FNA switch task: marked "[optional]" in the reply — **not started** pending explicit confirmation.
- Canary contacts: **still blank placeholders** — no live verification possible.

**How production was read.** The claude.ai Supabase connector (`execute_sql`, OAuth through the Vercel-marketplace
Supabase organization), project `ynxaqeejjmeilpwmuuie`. It connects as role **`postgres`** (`rolbypassrls = true`,
not superuser, `transaction_read_only = off`). **The path can write.** Every query in this audit was a SELECT; from
here on production reads are wrapped in a read-only transaction.

**Round 2 (owner, 2026-10-02).** Decisions on review findings 3a, 3b and 5, the property-test requirement and the
pre-merge questions are recorded in [`automation-audit-report.md` §1a](automation-audit-report.md#1a-checkpoint-decisions--round-2-owner-2026-10-02).
Canary contacts, `CRON_SECRET` and `SMS_A2P_APPROVED` remain **UNANSWERED** (placeholders).

## 11. Change log

| Date | Change |
|---|---|
| 2026-10-02 | Inventory created (phase 1). No code changes. |
| 2026-10-02 | Checkpoint decisions recorded (§10). Repairs implemented per §10 on `fix/automation-e2e`, one commit per repair with its regression test; migrations 138–141 added (not applied). Results, statuses and remaining items: [`automation-audit-report.md`](automation-audit-report.md). |
| 2026-10-02 | Round-2 owner decisions recorded (report §1a): findings 3a, 3b, 5, opt-out property test, pre-merge questions. |
