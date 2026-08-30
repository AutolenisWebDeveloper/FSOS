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
any of it. **Item 1–2 (the FFS approvals) is the deploy blocker** — the subsystem is inert
without it. Items 3 and 4 are closed; items 5 and 6 are provisioned but each carries a
NOT-VERIFIED fact recorded in place.

Approval-surface state below was queried against the real 133-migration chain in a
pristine Postgres, not read off the source. Anything this session could not establish —
Vercel environment contents, Vercel cron header behaviour, Twilio console facts, live
delivery — is marked NOT VERIFIED rather than assumed.

---

## 1–2. FFS approvals — the exact change, described before anyone runs it

**Tag: FFS. The principal has signed off; the data change has NOT been executed.**

Everything below was **queried against the real 133-migration chain** in a pristine
Postgres, not inferred from source. Three different tables use three different state
columns, so "at `submitted`" resolves differently in each.

### 1a. What is actually at `submitted` — exactly one row

| Table | Rows | State | Kinds |
|---|---|---|---|
| `comm_templates` (the ack gate handle) | **1** | `approval_status = 'submitted'` | email |
| `workshop_message_templates` | **25** | `status = 'placeholder'`, `active = false` — **none at `submitted`**; the column's CHECK allows only `placeholder` / `draft` / `approved` | see 1c |
| `workshop_disclosure_configs` | **4** | no status column — `is_assumption = true`, `approved_by` NULL, `approved_at` NULL | `sms`, `recording`, `seminar_advertising`, `educational` (all v1) |

The single `submitted` row is
`comm_templates.id = eeee0000-0000-4000-8000-00000000ac01` — "Workshop registration
instant acknowledgment (gate handle — awaiting FFS approval)", channel `email`, v1,
`approved_by` NULL, `approved_at` NULL.

### 1b. The exact data change per surface

**A. The instant-ack gate handle** (`comm_templates`) — via `PATCH /api/comms/templates/{id}`
with `action: 'approve'`. Requires a `compliance`, `supervisor`, or `super_admin` role.
Writes:

| Column | To |
|---|---|
| `approval_status` | `'approved'` |
| `approved_at` | `now()` |
| `approved_by` | **the acting user's UUID** — not a typed name, not a CRD |
| `version` | unchanged |

Gate step 4 (`isTemplateApproved`, `send.ts:281-293`) then passes:
`approval_status === 'approved' && !archived_at`.

**B. Disclosure configs** (`workshop_disclosure_configs`) — blessed through
`POST /api/workshops/{id}/approve`, which sets on the row:

| Column | To |
|---|---|
| `is_assumption` | `false` |
| `approved_by` | `approver_name` from the request — **a typed name** |
| `approved_at` | `now()` |

If the principal **edits the disclosure body** at approval time, the route does not
rewrite the row: it **inserts a new version** (`version = max+1`, `is_assumption=false`,
approver, timestamp) and binds the workshop to it, leaving the prior text intact. That is
the copy-version record.

**C. Workshop message templates** (`workshop_message_templates`) — activation is
**four columns on the row**, and the engine's selector
(`selectSendableTemplate`, `comms-engine.ts:237-266`) requires all of them:

| Column | To | Why |
|---|---|---|
| `subject` / `body` | the approved copy | placeholder text must be replaced |
| `status` | `'approved'` | `.eq('status','approved')` |
| `active` | `true` | `.eq('active', true)` |
| `comm_template_id` | an **approved** `comm_templates` row | `.not('comm_template_id','is',null)`, then gate step 4 re-checks it |
| `disclosure_config_id` | **SMS only** — a config with `is_assumption=false` AND `approved_by` non-null | `selectSendableTemplate:250-258` |

Note the approver identity/timestamp for a message template live on the **bound
`comm_templates` row**, not on `workshop_message_templates` — that table has no approver
columns at all (`id, kind, channel, subject, body, disclosure_config_id,
comm_template_id, status, is_assumption, active, version, created_at, updated_at`). Copy
version is its `version` integer, which the highest-version approved row wins.

### 1c. The 25 template rows

All at `placeholder` / `active=false` / `comm_template_id` NULL / `disclosure_config_id` NULL:

`cancel_ack`(email) · `change_reschedule`(email,sms) · `change_venue`(email,sms) ·
`confirmation`(email — **dead, D-8 deleted the kind; needs no approval**) ·
`event_cancelled`(email,sms) · `nurture_attended`(email,sms) ·
`nurture_followup`(email,sms) · `nurture_left_early`(email) ·
`nurture_no_show`(email,sms) · `nurture_registered_no_show`(email) ·
`reminder_1d`(email,sms) · `reminder_1h`(email,sms — not in the shipped cadence) ·
`reminder_3d`(email,sms) · `reminder_7d`(email) · `reminder_day_of`(sms) ·
`reminder_starting`(sms — virtual/hybrid only, WS-071)

### 1d. The provenance marker — ORDER MATTERS, and approving first destroys the approval

The ack handle's `body` opens with `PROVENANCE: pre-existing production receipt copy …
NOT principal-approved.` That text is a **compliance record only** — the receipt a
registrant sees is rendered by the route (`renderHtml(ackContent)`), never from this row's
body, so the marker cannot reach anyone. But leaving it in place after approval leaves a
row that says "approved" and "NOT principal-approved" at once.

**The approve action does not touch `body`** (`templates/[id]/route.ts:98-99` writes only
`approval_status`, `approved_at`, `approved_by`). So the marker must be edited out
separately — and the edit path **resets approval**: a PATCH bumps `version` and forces
`approval_status='draft'`, `approved_at=NULL`, `approved_by=NULL`
(`templates/[id]/route.ts:40-43`).

Required order:

1. **Edit the body** — replace the PROVENANCE preamble with the approved receipt copy.
   Row goes `submitted → draft`, `version 1 → 2`.
2. **Submit** — `action:'submit'` (requires `approval_status='draft'`; it now is).
3. **Approve** — `action:'approve'`. Stamps approver + timestamp on version 2.

Approving first and editing after silently destroys the approval and the receipt stops
sending again.

### 1f. The runbook, rehearsed against a real Postgres

The sequence below was executed against an ephemeral Postgres carrying the full
133-migration chain, modelling each route's exact writes. **No production database was
touched — this environment holds no database credentials at all.** These are the row
states production will show.

| Step | Action | Resulting row | Gate step 4 |
|---|---|---|---|
| — | as shipped by mig 132 | `submitted` · v1 · approver NULL · body `PROVENANCE:…` | **BLOCKS** |
| 1 | PATCH body (the approved copy) | `draft` · **v2** · approver NULL · `updated_by` set | **BLOCKS** |
| 2 | `action:"submit"` | `submitted` · v2 · `submitted_at` stamped | **BLOCKS** |
| 3 | `action:"approve"` | `approved` · v2 · **`approved_by` = acting user UUID** · `approved_at` stamped | **PASSES — the receipt sends** |
| ⚠️ | any edit AFTER step 3 | `draft` · v3 · approver NULL again | **BLOCKS** |

Step 2 is guarded on `approval_status='draft'` and affected exactly 1 row; run out of order
it returns 409 `invalid_state` rather than silently succeeding.

Retention evidence writes itself — `comm_template_versions` gained a snapshot of the
superseded body on each edit, trigger-written, append-only.

**The body to put in at step 1** is the compliance record of the copy the route renders
(`renderHtml(ackContent)` in the register route); it is never the text a registrant
receives, so the merge tokens below are documentation of the rendered fields:

```
You're registered, {{name}}.

Thanks for registering for "{{workshop_title}}" with Markist Athelus, Farmers Financial Services.
This is an educational event - no product recommendation.

Workshop: {{workshop_title}}
When: {{starts_local}}
Where: {{venue}}

We'll send a reminder before the event. If you did not register, you can ignore this email.
A calendar file (workshop.ics) is attached.
```

### 1g. Proving the receipt actually sends — without a live send

Gate step 4 is the only thing the approval changes, and no existing test exercises it with
a real approved handle: `workshop-lifecycle-routes.test.mjs` proves the route calls
`sendThroughGate` with the right handle and a decoded `.ics`, but it **stubs the gate**.

The smallest sufficient proof, in order of cost:

1. **Seeded non-production Supabase + the existing E2E suite.** Approve the handle there by
   the same three steps, then run with `FSOS_E2E_SUPABASE=1` and `FSOS_E2E_SLUG=<slug>`.
   That unskips the happy-path journey, which registers through the real route.
2. **Assert on the capture file, not the inbox.** The E2E server runs with
   `COMMS_CAPTURE_TRANSPORT` active — and the guard spec now proves that in the server
   process over HTTP before any test runs. A successful receipt appears as one JSON line:
   `channel:"email"`, `to:` the address registered with, `subject:"You're registered — <title>"`,
   `attachments:["workshop.ics"]`.
3. **Nothing can reach Resend.** `captureActive()` short-circuits before the provider call,
   and a capture-write failure fails the send rather than falling through — both proven by
   execution in `comms-capture-transport.test.mjs`.

What this proves: the real route, the real gate with a real approved handle, template
selection, personalization, and the exact payload including the calendar attachment.
What it does **not** prove: delivery, inbox placement, or `.ics` rendering in a real
calendar client — that stays item 9, and only a controlled live send closes it.

### ⚠️ CORRECTION — migration 132's guard does the OPPOSITE of what its comment claims

An earlier revision of this document stated that migration 132's guard leaves an approved
row alone on a chain re-run. **That is false, and rehearsing the approval against a real
Postgres proved it.** The guard is:

```sql
where id = 'eeee0000-…-00000000ac01'
  and body not like 'PROVENANCE:%';
```

It skips rows that **already carry** the marker — migration idempotency — and therefore
**fires on exactly the rows an approval has cleaned up**. Rehearsal result, re-applying 132
over the approved row:

```
approved/v3  →  submitted/v3     (CHANGED — the guard did not hold)
```

**Operational consequence: any migration replay after go-live silently un-approves the ack
handle and restores the placeholder body. The registration receipt stops sending, with no
error anywhere** — gate step 4 blocking is the route working as designed. A rebuilt
environment, a restored branch database, or a re-run chain all trigger it.

**Proposed fix — NOT applied, reported for your decision.** One added condition, which
reverses only an approval that has no approver (the WS-047 defect 132 exists to undo) and
never a principal's:

```sql
where id = 'eeee0000-…-00000000ac01'
  and body not like 'PROVENANCE:%'
  and approved_by is null;          -- never touch a row a principal has approved
```

The comment above the statement also needs correcting; it asserts the protection that is
missing.

### 1e. What goes live the moment these flip

Given A2P armed in production and `CRON_SECRET` set:

| Approval | What starts sending | Trigger | To whom |
|---|---|---|---|
| **Ack handle alone** | The registration receipt — subject "You're registered", with the `.ics` attachment | **Immediately, inside the registration request.** Not cron. | Every person who completes the public signup form, at the email they typed |
| **+ a disclosure config** | Nothing yet — but a workshop can now be **published**, which is what makes public registration possible at all (`server.ts:140-143`, plus the DB publish gate) | operator publishes | — |
| **+ reminder/lifecycle templates** | That kind's reminders and change notices | The `*/15` cron, subject to 6b | Registrants of published workshops, on the shipped cadence: 7d / 3d / 1d / 9:00 AM day-of / at-start (virtual & hybrid only) |
| **+ nurture templates** | Post-event nurture and the T+2d follow-up | Same cron, 180 min after session end | **Only registrants with `marketing_opt_in = true`** — the one signup checkbox |

Three things stay off regardless: securities workshops (firewalled to FFS, never
automated), SMS on any kind whose `disclosure_config_id` is unset or unapproved, and any
template whose bound `comm_templates` handle is not itself approved.

The narrowest safe first step is the ack handle **alone**: it restores the signup receipt,
sends nothing on a schedule, and reaches only people who just asked to register.

---

## 3. D-6 — `senior_focused`  ✅ ANSWERED (owner, 2026-08-30)

**Tag: OWNER — CLOSED.**

**Not senior-focused.** No state seminar-notice or advertising-filing requirement gates
template activation for this practice. The `senior_focused` flag stays in schema
(`workshops.senior_focused boolean default false`, plus `senior_disclosure_config_id`)
and defaults to false.

Nothing on this checklist waits on a notice or filing lead time. If a future workshop is
ever marketed to a senior audience, this item reopens and the notice/filing clock — which
can run weeks — starts then, before that workshop is advertised or published.

---

## 4. WS-025 — the physical mailing address  ✅ SUPPLIED (owner, 2026-08-30)

**Tag: OWNER — CLOSED.**

```
12800 Westridge Blvd, Ste 114, Frisco, TX 75035
```

Shipped as a data change in `supabase/migrations/133_workshop_sender_address.sql`, which
updates `workshop_comms_config.sender_physical_address`. Two guards on that migration:

- It only rewrites a value still carrying the `[PLACEHOLDER` marker, so an address set
  later through the config UI is never clobbered by a re-run of the chain.
- The **column DEFAULT stays the placeholder**. A fresh install with no config row must
  still fail closed rather than inherit one practice's address.

**Verified by execution, both directions:**

| Proof | Where |
|---|---|
| With the placeholder, a MARKETING email defers (`sender_address_placeholder`) | `workshop-engine-invocation.test.mjs`, `workshop-lifecycle.test.mjs` fixture E (real Postgres) |
| With the REAL address, the SAME marketing email **sends** — the deferral clears | `workshop-engine-invocation.test.mjs` (new) |
| The CAN-SPAM footer carries the real address, not the placeholder | same |
| A TRANSACTIONAL reminder receipt sends under **both** configs — unaffected either way | same |
| The shipped config row holds the real address after the migration chain | `workshop-lifecycle.test.mjs` (new, real Postgres) |
| The column default still fails closed | same |

Each new assertion was mutation-tested: forcing the marketing defer unconditionally, and
writing a wrong address in the migration, both kill their check.

---

## 5. A2P 10DLC — registered and approved; two items still NOT VERIFIED

**Tag: PLATFORM / OWNER.** Owner reports the brand and campaign are **registered and
approved**, and the environment variables are **already set in Vercel**.

### 5a. Environment variables the workshop SMS path requires

Read directly from the send path — `src/lib/messaging.ts:111-144`, `src/lib/comms/a2p.ts`:

| Variable | Required? | What breaks without it |
|---|---|---|
| `SMS_A2P_APPROVED` | **Yes**, must be `true`/`1`/`yes` | `smsA2pApproved()` is false → the gate defers every SMS at step `sms_live` (retryable), and `sendSms()` refuses independently with `sms_pending_a2p_approval`. Two separate stops. |
| `TWILIO_ACCOUNT_SID` | **Yes** | `Twilio env not set` — send fails |
| `TWILIO_AUTH_TOKEN` | **Yes** | `Twilio env not set` — send fails. Also signs/validates the inbound STOP/HELP webhook (`src/lib/comms/twilio.ts:13`) |
| `TWILIO_MESSAGING_SERVICE_SID` **or** `TWILIO_PHONE_NUMBER` | **One of the two** | `Twilio env not set`. The Messaging Service is *preferred* when set (`messaging.ts:121-122`) — it carries the number pool and carrier opt-out handling |
| `NEXT_PUBLIC_APP_URL` (or `APP_URL`) | Effectively yes | Used to build the Twilio `StatusCallback` URL; without it delivery/failure callbacks never come back. Separately, WS-034 makes the engine defer **email** with no app URL |

### 5c. Health surfaces report SMS unconfigured on a Messaging-Service-only setup

**Reported, NOT fixed.** `sendSms()` requires SID + TOKEN + (`TWILIO_MESSAGING_SERVICE_SID`
**or** `TWILIO_PHONE_NUMBER`) — `messaging.ts:123`. Three readiness surfaces use a
narrower predicate that demands `TWILIO_PHONE_NUMBER` specifically, so a working
Messaging-Service-only deployment reports SMS as unconfigured:

| Surface | Line | Predicate |
|---|---|---|
| `/api/health` | `route.ts:29` | `SID && TOKEN && PHONE_NUMBER` |
| Super-admin health page | `super/health/page.tsx:40` | `SID && TOKEN && PHONE_NUMBER` |
| `/api/forms/send` (`ready`) | `route.ts:26-33` | `SID && TOKEN && PHONE_NUMBER` |

**`smsConfigured()` in `messaging.ts:20` has ZERO callers** — it is dead code, and each of
the three surfaces inlines its own copy of the predicate. So correcting only
`smsConfigured()` would change nothing anyone sees; it is the three inlined copies that
produce the false signal.

Proposed change (one shared predicate, matching what `sendSms` actually requires):

```ts
export function smsConfigured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_PHONE_NUMBER)
  )
}
```

…then have all three surfaces import and call it instead of inlining. `/api/forms/send`
additionally reports `phone_number_set` as a separate field, which stays accurate as-is
and can remain alongside a corrected `ready`.

Scope note: `/api/health` and `/api/forms/send` are outside the workshop subsystem. The
change is small and local but touches three files beyond this branch's remit.

**Environments that must carry these:** whichever environments run the engine. The
workshop cron is a `vercel.json` entry (`*/15 * * * *`), and Vercel runs cron jobs against
**Production only** — so Production is the environment that matters for sending. Preview
needs them only if a live send is deliberately exercised there.

**This session cannot read Vercel environment variables** — no access. Presence is
reported by the owner and is **NOT VERIFIED here.**

### 5b. Still NOT VERIFIED (recorded, not closed)

1. **Campaign use-case coverage for BOTH message classes.** The workshop path sends two
   materially different classes under one A2P campaign:
   - **Event reminders / lifecycle notices** — transactional, registration is the consent
     basis (D-3): `reminder_3d`, `reminder_1d`, `reminder_day_of`, `reminder_starting`,
     `reminder_1h`, `change_reschedule`, `change_venue`, `event_cancelled`.
   - **Post-event nurture** — marketing, requires the registrant's opt-in box:
     `nurture_attended`, `nurture_no_show`, `nurture_followup`.

   Whether the registered use case and sample messages cover **both** is a Twilio-console
   fact. Nothing in this repo can establish it.

2. **Carrier-level Advanced Opt-Out.** Batch 7 shipped the application half — the
   `Reply STOP to opt out, HELP for help.` footer and a HELP auto-response returned as the
   webhook's own TwiML. Carrier-level keyword handling only proves out on live traffic.

---

## 6. `CRON_SECRET` — provisioned; one unverified platform behaviour decides whether the engine ever runs

**Tag: PLATFORM.** Owner reports `CRON_SECRET` exists in Vercel for **Production and
Preview** (added Jul 26). Not verifiable from this session.

### 6a. How the route is invoked

A **`vercel.json` cron entry** — `{ "path": "/api/cron/workshop-reminders", "schedule":
"*/15 * * * *" }`, the last of 24 entries. No external scheduler is involved.

### 6b. Does that caller send `Authorization: Bearer`?  ⚠️ NOT VERIFIED

This is the single fact that decides whether the workshop engine runs at all, and it could
not be established here: **vercel.com is blocked by this environment's egress proxy**, and
the Vercel docs MCP search returned only cron *configuration* pages, never the securing-
cron-jobs page. So the following is stated as risk, not fact.

`/api/cron/workshop-reminders` accepts **`Authorization: Bearer <CRON_SECRET>` only**
(WS-030, route:28-32). It does not accept the `x-vercel-cron` header.

- **If** Vercel attaches `Authorization: Bearer $CRON_SECRET` to cron invocations when the
  variable is set — the widely-documented behaviour — nothing needs to change. The engine
  runs every 15 minutes.
- **If it does not**, every tick returns **401** and the engine silently never runs. No
  reminders, no change notices, no nurture — and *no error surfaces to the app*, because a
  401 is the route working as designed.

**The exact check that settles it.** The route's auth failure is uniquely identifiable —
`401` with body `{"error":"unauthorized"}` is returned from **one place only**, the
`authorized()` check at `route.ts:35-37`. Every other failure path returns `500` with a
`{"job":"workshop-reminders", …}` payload, and success returns `200` with that same
payload. So the status code alone is decisive:

| Observed | Means |
|---|---|
| `200` + `{"job":"workshop-reminders","changes":…,"reminders":…,"nurture":…}` | Vercel sent the Bearer header. Nothing to change. |
| `401` + `{"error":"unauthorized"}` | It did not. The engine has never run. Pick an option below. |
| `500` + `{"job":…,"error":…}` | Auth passed; a pass failed. A different problem (WS-064). |

Where to look, in the Vercel dashboard for the `fsos` project: the cron job's invocation
history (Observability → Crons, or the Cron Jobs view in project settings) shows the most
recent runs and their status codes; Observability → Logs filtered to the path
`/api/cron/workshop-reminders` shows the same per-invocation. `vercel logs <production
deployment url>` gives it from the CLI.

Two conditions on the check: **Vercel runs cron against Production only**, so this cannot
be settled on a preview deployment; and the schedule is `*/15`, so a result is available
within 15 minutes of deploying rather than immediately.

(The dashboard navigation above is stated from general familiarity, not from the docs —
vercel.com is blocked by this environment's egress proxy. The status-code discriminator is
read directly from the route source and is exact.)

**If it turns out to be a 401**, the change and its cost:

| Option | Change | Cost |
|---|---|---|
| A. Restore header acceptance | Re-add `if (req.headers.get('x-vercel-cron')) return true` | **Reverses WS-030.** A forgeable client-supplied header would again authorize a live send engine. Not recommended — this was the highest-severity item in Batch 7. |
| B. Move the trigger off `vercel.json` | Drive the route from an external scheduler that sends the Bearer header | Keeps Bearer-only auth; adds an external dependency to provision and monitor. |
| C. Verify at the edge instead | Check `x-vercel-cron` **plus** a value only the platform can supply | Only sound if such a value exists and is verified; currently unproven. |

No option is taken here. The route stays Bearer-only.

### 6c. What else reads `CRON_SECRET`, and does the expected value match?

Four readers, and **the expected value is identical in all of them** — every one reads
`process.env.CRON_SECRET` and compares the header to the exact string
`` `Bearer ${secret}` ``. One secret serves all; nothing needs a second value.

| Reader | Accepts |
|---|---|
| `src/lib/env.ts:29` `cronSecret()` | (accessor only — the single named resolution) |
| `/api/cron/[job]` (catch-all, 21 jobs) | `x-vercel-cron` header **OR** Bearer |
| `/api/cron/booking-reminders` | `x-vercel-cron` header **OR** Bearer |
| `/api/cron/social-publish` | `x-vercel-cron` header **OR** Bearer |
| `/api/cron/workshop-reminders` | **Bearer only** (WS-030) |

The workshop route differs only in what it *accepts*, never in the value it expects. That
also means 6b is testable without deploying anything new: the three other cron routes
already run on this schedule, so if their invocations currently succeed via the header
alone, that tells you nothing — but a Bearer-only 401 on the workshop route would show up
in the same log.

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

Items 3 (D-6) and 4 (WS-025) are **closed**. What remains:

1. **FFS** — the instant-ack gate handle, in the order at 1d: **edit the body first**,
   then submit, then approve. Editing after approving destroys the approval.
2. **FFS** — approve at least one disclosure config; a workshop cannot publish without one.
3. **PLATFORM** — confirm the `*/15` cron actually authorizes (6b). A 401 loop is silent:
   check the invocation log for `/api/cron/workshop-reminders` after deploying.
4. **PLATFORM / OWNER** — settle the two open A2P items (5b): campaign coverage for both
   message classes, and carrier-level Advanced Opt-Out.
5. **FFS** — approve template copy per kind (1b/1c), narrowest set first.
6. **PLATFORM** — the controlled live-send verification (item 9). Nothing above proves
   delivery.
7. Separately scoped, not blocking: the cron header-auth item (item 7).
