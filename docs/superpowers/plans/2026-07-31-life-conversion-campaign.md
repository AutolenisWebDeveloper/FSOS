# Life Conversion Campaign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 180-day, 20-touch, multi-channel (email / SMS / AI-conversation / advisor-outreach) Life Conversion Campaign as a first-class extension of FSOS's native communications engine — reusing the compliance gate, pause/resume lifecycle, eligibility source, audit log, and RBAC rather than building a parallel system.

**Architecture:** A dedicated Life-Conversion campaign module (`src/lib/life-campaign/*`, `/app/comms/life-conversion`, migrations `081`/`082`) that layers a **single per-contact multi-channel timeline** on top of the existing send path. The timeline (20 ordered touches) is stored as campaign-scoped touch rows; each enrollment carries a baseline date + cursor and is advanced by a durable cron tick that re-checks eligibility before every touch and dispatches every client-facing send through `sendThroughGate()`. Pause/resume reuses `evaluateResume()`; eligibility reuses `v_conversions_due` + the term-conversion planner and adds the **Active Opportunity Ownership** rule.

**Tech Stack:** Next.js 14 App Router, TypeScript (strict), Supabase Postgres + RLS, Vercel Cron, Tailwind + shadcn/ui, Zod. Test harness: `tests/*.test.mjs` compiled with `tsc` (auto-discovered by `scripts/run-tests.mjs`).

## Global Constraints

- **Aggregate root** is the Agency Partnership; the campaign hangs off `households`/`household_members`/`household_policies`, never a generic contact/deal. (CLAUDE.md §0, ADR-001)
- **Reuse, never duplicate:** one dispatcher (`sendThroughGate`), one pause/resume lifecycle (`evaluateResume` + `paused_for_conversation`), one eligibility source (`v_conversions_due` + `termconversion.ts`), one audit log (`writeAudit`), one RBAC (`rbac.ts`). (CLAUDE.md §6)
- **Securities firewall:** any `is_security` policy is excluded from all automated outreach; every campaign send passes `isSecurity:false` derived from the DB row, never a caller literal. (§4.1, ADR-004)
- **AI red-line:** all §14 copy is green-zone (education/invitation). Every template seeds a **DRAFT** `comm_templates` row and passes human approval before dispatch — "final copy" means engineering does not rewrite it, NOT that it bypasses approval. Run `containsRecommendationLanguage()` over every body in a test. (§4.2, ADR-023)
- **No invented Farmers data:** cooldowns, timeouts, quiet-period, GDC-style values ship as editable config defaults with `is_assumption = true`. (§4.3)
- **Comms compliance:** consent → quiet-hours (9am–8pm recipient-local hard floor) → DNC → approved template/policy → recommendation → securities → data-confidence, enforced by the existing gate, not re-implemented. (§12)
- **Active Opportunity Ownership (Checkpoint 1, owner-approved 2026-07-31):** an active `term_conversion` opportunity outranks campaign automation. Ineligible while an opp is open; Closed Won = permanent exclusion; terminal-without-conversion = re-eligible after a configurable cooldown; a reopened opp immediately pauses/removes the enrollment. Eligibility is recomputed before enrollment **and** before every scheduled touch. One owner per objective.
- **RBAC:** roles from `ROLES` in `rbac.ts` (`super_admin`, `fsa`, `licensed_staff`, `admin`, `ops`, `compliance`, `supervisor`, `agency_owner`, …). Operational controls restricted to `admin`/`ops`/`super_admin` (+ `agency_owner` for their own scope); `compliance`/`supervisor` get visibility on emergency events.
- **`marketing-plan` skill is absent** with no approved source — documented environmental limitation, non-blocking; campaign strategy/copy is NOT redesigned.
- **No live sends / no production creds:** migrations authored not applied; providers sandbox/mock; PR is draft. (§0.5)

---

## File Structure

**Migrations**
- `supabase/migrations/081_life_conversion_campaign.sql` — schema: `life_campaigns`, `life_campaign_touches`, `life_campaign_enrollments`, `life_campaign_executions`, `life_advisor_touches`; RLS; `grant select … to authenticated`; indexes; append-only audit respected.
- `supabase/migrations/082_life_conversion_seed.sql` — seed one campaign, its 20 touch rows, and the §14 `comm_templates` (DRAFT).

**Pure logic (no DB/clock — fully unit-tested)**
- `src/lib/life-campaign/schedule.ts` — `TOUCH_SCHEDULE` (20 touches), `computeTouchPlan`, `nextDueTouch`, `earlyEnrollmentFits`, channel-alternation/one-per-day invariants.
- `src/lib/life-campaign/states.ts` — campaign 7-state machine (`canTransition`, `canDispatch`) + enrollment lifecycle.
- `src/lib/life-campaign/eligibility.ts` — `evaluateEligibility` (Active Opportunity Ownership, suppression, dedupe, cooldown, securities).
- `src/lib/life-campaign/advisor.ts` — advisor-touch completion policy (`advisorTouchState`, reminders, escalation, proceed-vs-hold).
- `src/lib/life-campaign/conversation.ts` — `evaluateConversationTimeout`, `resolveOwner` handoff (composes with `evaluateResume`).

**Services (DB)**
- `src/lib/life-campaign/enroll.ts` — `enrollContact`, `removeEnrollment` (eligibility recompute + idempotent insert + baseline).
- `src/lib/life-campaign/tick.ts` — `lifeCampaignTick` (advance due enrollments; re-check ownership; fire touch via gate / create advisor task; write execution; advance/complete).
- `src/lib/life-campaign/controls.ts` — `applyControl` (enable/disable/pause/resume/emergency-stop/archive) + `deadlineExposure`.
- `src/lib/life-campaign/analytics.ts` — KPI/event aggregation for the dashboard.

**API (thin: parse → authorize → service → typed response; `dynamic`+`runtime`; Zod)**
- `src/app/api/life-campaign/route.ts` — GET list + status.
- `src/app/api/life-campaign/enroll/route.ts` — POST manual enroll / DELETE manual removal.
- `src/app/api/life-campaign/[id]/control/route.ts` — POST control action.

**Background job**
- `src/jobs/handlers.ts` — `lifeConversionTick()` handler; register in `src/jobs/index.ts`; add cron to `vercel.json`.

**UI**
- `src/app/(fsa)/app/comms/life-conversion/page.tsx` — dashboard (status, phase counts, controls, KPIs, enrollment list, all states).
- small presentational components co-located.

**Docs**
- `docs/adr/ADR-029-life-conversion-campaign.md` — the multi-channel timeline + Active Opportunity Ownership decision.
- update `DESIGN.md` only if a new pattern is introduced (aim to reuse existing archetypes → no change expected).

**Tests**
- `tests/life-campaign-schedule.test.mjs`, `tests/life-campaign-states.test.mjs`, `tests/life-campaign-eligibility.test.mjs`, `tests/life-campaign-advisor.test.mjs`, `tests/life-campaign-conversation.test.mjs`, `tests/life-campaign-templates.test.mjs` (green-zone copy check).

---

## Phase / Task List

### Task 1: Schedule & timing engine (pure, TDD)
**Files:** Create `src/lib/life-campaign/schedule.ts`; Test `tests/life-campaign-schedule.test.mjs`
**Produces:** `TOUCH_SCHEDULE: TouchDef[]` where `TouchDef = { touch_no:number; day_offset:number; kind:'email'|'sms'|'ai_conversation'|'advisor_outreach'; asset_label:string }`; `computeTouchPlan(baselineISODate:string): {touch_no;kind;dueDate:string}[]`; `nextDueTouch(currentTouchNo:number, baselineISODate:string): {touch_no;kind;dueDate}|null`; `earlyEnrollmentFits(deadlineISODate:string, baselineISODate:string, bufferDays:number): boolean`.
- [ ] Test: `TOUCH_SCHEDULE` has exactly 20 touches; mix 7 email / 6 sms / 5 ai_conversation / 2 advisor_outreach; days match §5 table (1,4,8,15,24,35,48,60,75,90,105,120,135,145,152,158,165,171,176,180).
- [ ] Test: Day 135–180 phase alternates channels (no two consecutive same channel).
- [ ] Test: `computeTouchPlan('2026-01-01')` puts touch #20 on day 180 → `2026-06-30`; never two touches same calendar day.
- [ ] Test: `earlyEnrollmentFits` false when deadline < baseline+180+buffer.
- [ ] Implement; run `node tests/life-campaign-schedule.test.mjs`; commit.

### Task 2: Operational + enrollment state machines (pure, TDD)
**Files:** Create `src/lib/life-campaign/states.ts`; Test `tests/life-campaign-states.test.mjs`
**Produces:** `CAMPAIGN_STATES` (`draft|approval_pending|active|paused|disabled|emergency_stopped|archived`); `canDispatch(state):boolean` (true only for `active`); `canTransition(from,to):boolean`; `ENROLLMENT_STATES` (`active|paused_for_conversation|paused_by_admin|completed|exited|suppressed`); `enrollmentCanReceiveTouch(state):boolean`.
- [ ] Test: only `active` dispatches; `archived` is terminal (no outgoing transitions); `emergency_stopped → active` allowed (deliberate re-enable) but `archived → active` not.
- [ ] Test: enrollment touch only fires from `active`.
- [ ] Implement; run test; commit.

### Task 3: Eligibility — Active Opportunity Ownership (pure, TDD)
**Files:** Create `src/lib/life-campaign/eligibility.ts`; Test `tests/life-campaign-eligibility.test.mjs`
**Produces:** `evaluateEligibility(input): {eligible:boolean; reasons:EligibilityReason[]}` where input carries `{ isSecurity, openOpportunities:{stage:string}[], priorEnrollmentActive:boolean, optedOut:boolean, lastTerminalAt:string|null, cooldownDays:number, now:string, conversionDeadline:string|null }`. Reasons: `securities_excluded | active_opportunity | closed_won | duplicate_active | opted_out | cooldown | no_verified_deadline`.
- [ ] Test: `is_security` → `securities_excluded`.
- [ ] Test: an open (non-terminal) `term_conversion` opp → `active_opportunity` (ineligible).
- [ ] Test: a `placed_issued`/closed-won opp → `closed_won` (permanent).
- [ ] Test: closed-lost + terminal within cooldown → `cooldown`; past cooldown → eligible.
- [ ] Test: `optedOut` → `opted_out`; active enrollment → `duplicate_active`.
- [ ] Implement using `TERMINAL_STAGES`/`OPEN_STAGES` semantics from `termconversion.ts`/`originate.ts`; run test; commit.

### Task 4: Advisor-touch completion policy (pure, TDD)
**Files:** Create `src/lib/life-campaign/advisor.ts`; Test `tests/life-campaign-advisor.test.mjs`
**Produces:** `advisorTouchState(input): {status:'due'|'overdue'|'escalate'|'reassign'|'fulfilled'|'missed'; nextReminderAt:string|null}`; `campaignProceedsPastAdvisor(behavior:'proceed'|'hold'):boolean`. Input `{ dueAt, now, attemptLogged, remindersSent:string[], overdueEscalateHours, reassignAfterHours }`.
- [ ] Test: attempt logged → `fulfilled`.
- [ ] Test: now < due → `due`; past due, no attempt → `overdue`; past escalate threshold → `escalate`; past reassign → `reassign`.
- [ ] Test: default proceed (option b) — `campaignProceedsPastAdvisor('proceed') === true`.
- [ ] Implement; run test; commit.

### Task 5: Conversation timeout + ownership handoff (pure, TDD)
**Files:** Create `src/lib/life-campaign/conversation.ts`; Test `tests/life-campaign-conversation.test.mjs`
**Produces:** `evaluateConversationTimeout(input): {close:boolean; outcome:'abandoned'|null}` (input `{minutesSinceLastReply, timeoutHours, escalatedToAdvisor}` — when escalated, the AI does NOT auto-close/resume; advisor owns the clock); `resolveOwner(input): 'ai'|'advisor'` (once escalated + assigned → advisor; AI read-only).
- [ ] Test: silent past timeout, not escalated → `close:true, abandoned`.
- [ ] Test: escalated to advisor → never auto-close (`close:false`).
- [ ] Test: `resolveOwner` returns `advisor` after assignment; AI read-only.
- [ ] Implement; run test; commit.

### Task 6: Schema migration 081
**Files:** Create `supabase/migrations/081_life_conversion_campaign.sql`
- [ ] Tables with `is_assumption` config columns, CHECK constraints matching the state machines, `unique(campaign_id, member_id)` on enrollments, `unique(enrollment_id, touch_no)` on executions.
- [ ] `alter table … enable row level security`; policies keyed to owner scope; `grant select … to authenticated` (RLS firewall proof depends on the grant).
- [ ] Indexes on `(status)`, `(next_touch_at)` partial where status='active', `(campaign_id, member_id)`.
- [ ] Idempotent (`create table if not exists`, `drop policy if exists`), forward-only, transaction-safe (no explicit BEGIN/COMMIT — matches `scripts/migrate.mjs --single-transaction`).

### Task 7: Seed migration 082 + green-zone copy test
**Files:** Create `supabase/migrations/082_life_conversion_seed.sql`; Test `tests/life-campaign-templates.test.mjs`
- [ ] Insert the seven emails, six SMS, five AI conversation starters from §14 verbatim as DRAFT `comm_templates` (channel email/sms; ai_conversation stored as sms-channel starter or a dedicated category), `approval_status='draft'`.
- [ ] Insert one `life_campaigns` row (status `draft`) + 20 `life_campaign_touches` rows linking templates by touch_no.
- [ ] Test compiles the copy constant and asserts `containsRecommendationLanguage(body) === false` for every body (reuse `guardrail.ts`).
- [ ] Idempotent inserts (`on conflict do nothing` by stable natural keys).

### Task 8: Enrollment service
**Files:** Create `src/lib/life-campaign/enroll.ts`
- [ ] `enrollContact({memberId, policyId, campaignId, actor, manualOverride?})`: load conversion row + open opps + prior enrollment; `evaluateEligibility`; on eligible insert enrollment (`active`, baseline=today, next_touch_at from `computeTouchPlan`), audit `entity.created`; on ineligible return typed reason (audit only if manual). Idempotent via unique constraint (duplicate → no-op/typed reject).
- [ ] `removeEnrollment({enrollmentId, actor, reason})`: set `exited`, audit `entity.updated`.

### Task 9: Scheduler tick service + cron
**Files:** Create `src/lib/life-campaign/tick.ts`; Modify `src/jobs/handlers.ts`, `src/jobs/index.ts`, `vercel.json`
- [ ] `lifeCampaignTick()`: for each `active` campaign, select `active` enrollments with `next_touch_at <= now` (cap 1000). For each: recompute eligibility (ownership!) → if lost, pause/exit + audit; else fire due touch — email/sms/ai_conversation via `sendThroughGate` (isSecurity:false, purpose from campaign, delegation/ownership ctx, dataConfidence from declared claims); advisor_outreach → create `work_tasks` row + `life_advisor_touches`, mark execution `fulfilled` when attempt logged else advance per proceed policy. Write `life_campaign_executions` (idempotent unique). Advance cursor / complete. Reuse `dripAdvance` patterns; A2P SMS hold + template-approval skip identical.
- [ ] Register `'life-conversion-tick'` in `JOBS`; add `lifeConversionTick` handler; add `{ "path": "/api/cron/life-conversion-tick", "schedule": "0 13 * * *" }` to `vercel.json`.

### Task 10: Controls service + deadline exposure
**Files:** Create `src/lib/life-campaign/controls.ts`
- [ ] `applyControl({campaignId, action, actor, roles, reason})`: authorize via `rolesIntersect`; validate transition via `canTransition`; emergency-stop halts all channels (state gate = single source since only `active` dispatches); on disable/emergency-stop compute `deadlineExposure` (enrolled contacts whose `conversion_deadline` falls within the projected outage) and return it; audit `config.changed` with `{prev,next,reason,actor}`.

### Task 11: API routes
**Files:** Create `src/app/api/life-campaign/route.ts`, `enroll/route.ts`, `[id]/control/route.ts`
- [ ] Each: `export const dynamic='force-dynamic'`, `runtime='nodejs'`, `getDb()`, Zod input, `requireApiRole`, service call, typed response, safe errors.

### Task 12: Dashboard UI
**Files:** Create `src/app/(fsa)/app/comms/life-conversion/page.tsx` (+ components)
- [ ] Server component: campaign status chip, phase counts, KPI tiles (`analytics.ts`), enrollment table (search/filter/sort/paginate), control buttons (gated), deadline-exposure warning on stop/disable. Full loading/empty/error/success states; WCAG 2.2 AA; tokens only.

### Task 13: ADR + report + verification
**Files:** Create `docs/adr/ADR-029-life-conversion-campaign.md`; update this plan's checkboxes.
- [ ] ADR records the multi-channel timeline extension + Active Opportunity Ownership.
- [ ] `npm run build`, `npm run type-check`, `npm run lint`, `node scripts/run-tests.mjs unit` all green.
- [ ] Commit, push `-u origin claude/life-conversion-campaign-impl-lgmj8b`, open DRAFT PR.

---

## Self-Review

**Spec coverage:** §4 rules → Tasks 3,8,10. §4a edge cases → Tasks 3,8. §4b operational controls/7 states → Tasks 2,10,11,12. §5 schedule/timing → Task 1,9. §5a advisor-as-touch → Tasks 4,9. §6/§6a conversation/intents → Tasks 5,9 (intent classification playbook is a documented follow-up; timeout/handoff/pause-resume are implemented). §7 AI workflow → Tasks 5,9. §8 CRM integration (appointment/application/conversion exits) → Task 9 (exit hooks). §9/§9a advisor tasks → Tasks 4,9. §10 escalation → Tasks 5,9. §11 opt-out → reuses existing STOP handling (gate/inbound) + `opted_out` eligibility. §12 compliance → gate reuse. §13/§13a-c state machine/entities → Tasks 2,5,9; entity mapping in ADR-029. §14 assets → Task 7. §15 analytics → Tasks 9,12. §16 cross-cutting → all. §17 checklist → Task 13.

**Known scoping note (disclosed, not hidden):** full conversational-AI intent classification (§6a's 15 intents) and the appointment/application downstream workflows are wired at their campaign *boundaries* (pause on reply, exit on appointment/application/conversion, escalation handoff) but their internal playbooks reuse/extend existing conversation + opportunity subsystems and are called out as the next slice in ADR-029 rather than re-implemented here. Checkpoint 2 (schedule asset-name vs review-framed copy theme mismatch) remains open for compliance sign-off; copy is implemented verbatim per §1/§14 meanwhile.
