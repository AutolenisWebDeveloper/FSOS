# Workshop subsystem — GO-LIVE CHECKLIST

Everything that must be true before the `claude/workshop-subsystem-audit-iyifiz` branch
ships. **None of it is code.** Every item here is a data change, a business decision, a
provisioning step, or an accepted risk — the code work is done and proven (Batches 0–8;
see `WORKSHOP_PLAN.md` execution records).

Each item is tagged with who must act:

| Tag | Who | Meaning |
|---|---|---|
| **OWNER** | The FSA (Markist Athelus) | A business decision or a fact only the owner can supply. |
| **FFS** | Farmers Financial Solutions' registered principal | Compliance approval. Not the owner, and never Claude. |
| **PLATFORM** | Whoever administers Vercel / Twilio / Resend | Provisioning or configuration outside the app code. |

Nothing on this list is blocked by the branch, and shipping the branch does not perform
any of it. Items 1 and 2 are **deploy blockers** — the subsystem is inert without them.

---

## 1. FFS approval — the instant-ack gate handle  ⛔ DEPLOY BLOCKER — DO THIS FIRST

**Tag: FFS**

The registration receipt ("You're registered") is the single confirmation of record
(decision D-8). Batch 5 routed it through `sendThroughGate`, which requires an approved
`comm_templates` row to satisfy gate step 4.

That handle (`comm_templates.id = eeee0000-0000-4000-8000-00000000ac01`) is currently
`approval_status = 'submitted'` with a PROVENANCE body recording that it is pre-existing
production copy brought under the gate — **not** principal-approved. Migration 132
deliberately reversed an earlier seeded approval: a migration writing "approved" with no
approver, no timestamp and no copy version is the same audit-trail defect as WS-047.

**Until a firm principal approves this row, the registration receipt does not send.**
A registrant would complete signup and receive nothing. That is why this item is first.

- The copy to review is the rendered receipt: heading "You're registered", the event
  detail rows (workshop / when / where), the educational-event note, and the `.ics`
  calendar attachment.
- Approval is a **data change** recorded by the approval workflow (approver name,
  timestamp, copy version) — never a migration, and never a `UPDATE ... approved` by hand.
- Migration 132's update is guarded on the provenance marker, so a principal approval
  **survives** a later re-run of the migration chain (proven).

---

## 2. FFS approval — the workshop message templates  ⛔ DEPLOY BLOCKER for comms

**Tag: FFS**

Every workshop template ships as a **placeholder draft** (decision D-5). The engine
cannot select an unapproved template: it records a `template_not_approved` deferral and
sends nothing. Activation is a data change (set the copy, `status='approved'`,
`active=true`, bind an approved `comm_templates` handle) — never a code deploy.

**Current state: 25 template rows, 0 approved. 4 disclosure configs, 0 approved.**

### 2a. Pre-event cadence (transactional — registration is the consent basis, D-3)

| Kind | Channels | In the shipped default cadence? |
|---|---|---|
| `reminder_7d` | email | Yes (offset 10080) |
| `reminder_3d` | email + SMS | Yes (offset 4320) |
| `reminder_1d` | email + SMS | Yes (offset 1440) |
| `reminder_day_of` | SMS | Yes (wall-clock 9:00 AM venue-local) |
| `reminder_starting` | SMS | Yes (offset 0) — **virtual/hybrid sessions only** (WS-071) |
| `reminder_1h` | email + SMS | **No** — retained capability; fires only if an operator adds offset 60 |

### 2b. Lifecycle service notices (transactional)

| Kind | Channels |
|---|---|
| `change_reschedule` | email + SMS |
| `change_venue` | email + SMS |
| `event_cancelled` | email + SMS |
| `cancel_ack` | email |

### 2c. Post-event nurture (MARKETING tier — requires the registrant's opt-in box)

| Kind | Channels |
|---|---|
| `nurture_attended` | email + SMS |
| `nurture_left_early` | email |
| `nurture_no_show` | email + SMS |
| `nurture_registered_no_show` | email |
| `nurture_followup` | email + SMS (the T+2/3d second touch) |

### 2d. Disclosure configs — 4 rows, all placeholders

`sms`, `recording`, `seminar_advertising`, `educational`. **A workshop cannot be
published at all until at least one disclosure config is approved** — the publish gate
(route + DB trigger) requires an approved, non-placeholder config. SMS templates
additionally require an approved SMS disclosure before the engine will select them.

### 2e. Dead row — no approval needed

`confirmation / email` still exists as a placeholder row but the engine kind was
**deleted** by D-8. Nothing selects it. It needs no approval and can be left or removed.

---

## 3. D-6 — `senior_focused`: still open, OWNER to answer

**Tag: OWNER**

Batch 3 shipped the schema unconditionally (`workshops.senior_focused` boolean default
false, plus `senior_disclosure_config_id`). The **business answer is still open** and is
the owner's to give.

> **If YES** — if any workshop is marketed to a senior audience — state-level
> seminar-notice and advertising-filing requirements attach. Those notice and filing
> lead times **gate activation and can run weeks**. That lead time is not a code
> dependency: it is calendar time that must be started before the first senior-focused
> workshop can be advertised or published.

If NO, the flag stays false and nothing further is required.

---

## 4. WS-025 — the real physical mailing address

**Tag: OWNER**

CAN-SPAM requires a valid physical postal address on commercial email.
`workshop_comms_config.sender_physical_address` currently holds
`[PLACEHOLDER - set the FSA business mailing address …]`.

Batch 7 made this **fail closed**: while the placeholder is present, marketing-tier
workshop email DEFERS (`sender_address_placeholder`, audited) and nothing is sent.
Transactional reminder-class receipts are unaffected. Supply the address (a data change
to the config row) and the marketing tier resumes on the next tick.

---

## 5. A2P 10DLC — campaign coverage + Advanced Opt-Out

**Tag: PLATFORM** (with **OWNER** input on the registered use case)

- The registered A2P campaign must **cover the workshop use case**. Workshop reminders
  and lifecycle notices are a distinct message class from the existing campaign traffic;
  confirm the registered campaign's use case and sample messages cover them, or register
  accordingly.
- **Advanced Opt-Out** (carrier-level keyword handling) — **NOT VERIFIED by any batch.**
  Batch 7 shipped the application-level half: the STOP/HELP footer
  (`Reply STOP to opt out, HELP for help.`) and a HELP auto-response returned as the
  webhook's own TwiML. Carrier-level behavior must be confirmed in the Twilio console.
- SMS stays **staged** until `SMS_A2P_APPROVED=true`. While staged, the gate defers SMS
  (`sms_live`, a retryable hold — not a terminal block), so nothing is lost.

---

## 6. `CRON_SECRET` provisioned

**Tag: PLATFORM**

Batch 7 (WS-030) removed header-trust from `/api/cron/workshop-reminders`: authorization
is the Bearer `CRON_SECRET` **only**, and with no secret configured **the route refuses
every request** (fail closed).

**Consequence: if `CRON_SECRET` is not provisioned in the deploy environment, the
workshop comms engine never runs.** No reminders, no change notices, no nurture. Vercel
sends `Authorization: Bearer <CRON_SECRET>` on cron invocations once the env var is set.

---

## 7. PLATFORM — `/api/cron/[job]` still accepts header-only authorization

**Tag: PLATFORM. Out of scope for this branch; NOT fixed here.**

`src/app/api/cron/[job]/route.ts:17` returns `true` on the presence of the
client-supplied `x-vercel-cron` header alone, without the Bearer secret — the same
pattern WS-030 removed from the workshop route. Recorded here so it can be **scoped
separately**.

**Deploying this branch neither fixes this nor depends on it.** The workshop engine is
on its own static route with its own (now Bearer-only) auth.

While enumerating the affected jobs, two **additional** routes were found with the same
pattern — recorded for accurate scoping, both send-capable:

| Route | Auth today | Notes |
|---|---|---|
| `/api/cron/[job]` (catch-all) | header **or** Bearer | 21 scheduled jobs, listed below |
| `/api/cron/booking-reminders` | header **or** Bearer | Sends booking reminder SMS/email |
| `/api/cron/social-publish` | header **or** Bearer | Publishes social content |
| `/api/cron/workshop-reminders` | **Bearer only** ✅ | Fixed in Batch 7 (WS-030) |

**Jobs reachable through the catch-all** (from `vercel.json` + `src/jobs/index.ts`):
`renewal-watch`, `conversion-watch`, `xdate-watch`, `cross-sell-scan`,
`agency-dormancy`, `commission-reconcile`, `referral-sla`, `workforce-orchestrator`,
`campaign-dispatch`, `resume-paused`, `life-conversion-tick`, `life-conversion-retry`,
`pipeline-winback-tick`, `pipeline-winback-retry`, `cross-sell-life-enroll`,
`cross-sell-life-tick`, `cross-sell-life-retry`, `district-nurture-tick`,
`district-nurture-retry`, `data-quality`, `backup-verify`. Also registered but not
scheduled: `agent-runner` (alias of `workforce-orchestrator`).

Several of these dispatch client-facing messages (`campaign-dispatch`,
`life-conversion-tick`, `pipeline-winback-tick`, `cross-sell-life-tick`,
`district-nurture-tick`, `workforce-orchestrator`), so the same "forgeable header
triggers a live send engine" reasoning that made WS-030 the top Batch-7 item applies to
them. Scope separately.

---

## 8. WS-B13 — known operational gap, DEFERRED (accepted)

**Tag: OWNER (accepted risk) / PLATFORM (if mitigated)**

The public registration throttle (`src/lib/http/rate-limit.ts`) is an **in-memory Map**.
It **does not throttle across serverless instances**: a fan-out defeats the 5/min/IP cap,
and shared IPs (NAT) collide with each other.

Deliberately deferred, not dropped. Mitigations already in place: the honeypot field, the
atomic capacity claim (a flood cannot oversell a session), and the per-workshop duplicate
guard (one active registration per email). Accepted for launch scale; revisit with a
shared store (e.g. Postgres or Redis-backed counter) if abuse appears.

Also deferred, recorded: **WS-050** (server-side MIME validation on asset upload),
**WS-063** — refuted, no action (the `ics_uid` UNIQUE constraint already exists).

---

## 9. Live provider delivery — NOT VERIFIED by any batch

**Tag: PLATFORM**

**No batch sent a single live email or SMS.** This is a hard boundary of the whole
engagement, and it means provider-side behavior is unproven by construction:

- Every test intercepts the provider boundary. The RLS guarantee suite stubs
  `globalThis.fetch` for Resend and Twilio; the Playwright suite runs on **captured
  transport** (writes to a capture file, asserts nothing left the process).
- What IS proven: the code path end-to-end through the real gate and real dispatcher
  against a real Postgres — claims, consent basis, quiet hours, suppression, template
  gating, idempotency, and the exact provider payloads that *would* be sent.
- What is NOT proven: actual delivery, inbox placement, DKIM/SPF/DMARC alignment in
  production, carrier filtering, Twilio A2P throughput, or `.ics` rendering in real
  calendar clients.

**What the Playwright suite actually ran** (Batch 8, in this container): 16 browser
checks passed against the real built app — hub render, skip-link focus order, honest
degradation with no raw error text, single `h1`, no horizontal overflow at 375px, the
self-cancel page's recovery states (including that a bare GET cannot cancel anyone), and
a visible keyboard focus indicator (WS-055). **12 data-dependent journey checks SKIPPED**
— register → confirm, duplicate registration, capacity-full, registrant cancel, admin
check-in, agency reschedule — because they need a reachable Supabase and this container
has none. They skip with a printed reason (`FSOS_E2E_SUPABASE=1` + `FSOS_E2E_SLUG`), so
an unconfigured run can never be mistaken for coverage. Run them against a seeded
NON-PRODUCTION project before go-live.

**Before enabling production traffic**, run a controlled end-to-end test send to
addresses/numbers the FSA owns — one email, one SMS, one `.ics` — and verify STOP, HELP,
and the status callbacks land as expected. That is the only way these become verified.

---

## Ordered sequence

1. **FFS** approves the instant-ack gate handle (item 1) — otherwise signup receipts fail.
2. **OWNER** answers D-6 (item 3). If YES, start the notice/filing clock **now** — weeks.
3. **OWNER** supplies the physical mailing address (item 4).
4. **PLATFORM** provisions `CRON_SECRET` (item 6) — otherwise the engine never runs.
5. **PLATFORM/OWNER** confirm A2P campaign coverage + Advanced Opt-Out (item 5).
6. **FFS** approves disclosure configs, then template copy per kind (item 2) — a workshop
   cannot publish without an approved disclosure.
7. **PLATFORM** runs the controlled live-send verification (item 9).
8. Separately scoped, not blocking: the cron header-auth item (item 7).
