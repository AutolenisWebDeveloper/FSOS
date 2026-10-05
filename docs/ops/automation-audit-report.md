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

## 1a. Checkpoint decisions — round 2 (owner, 2026-10-02)

Decisions on the open review findings (§9), recorded before implementation. Values the reply left as unfilled
placeholders are recorded as **UNANSWERED**; nothing is inferred for them.

| # | Decision |
|---|---|
| Finding 5 | **Approved.** Move the Life Conversion, Win-Back and Cross-Sell text crons (`life-conversion-tick`, `pipeline-winback-tick`, `cross-sell-life-tick`) to 17:00 UTC, as decision 8 did for `campaign-dispatch` and `district-nurture-tick`. Decision 8's hourly option stands: if the Vercel plan allows hourly crons, run these dispatch crons hourly; if kept daily because of a plan limit, say which. |
| Finding 3a | **Stricter rule.** When the phone's and the address's time zones disagree, send only when the time is inside the floor in **both**. |
| Finding 3b | **Keep decision 1** for US numbers whose zone cannot be resolved (continental intersection). **Numbers outside the US — including +1 numbers in Canada and the Caribbean — are a hard block for automated SMS.** Update CLAUDE.md to match decision 1 and this rule. Report how many contacts resolve to unknown or non-US today, ids only. |
| Property test | Before merge: an exhaustive property test of the opt-out/consent logic over every sequence of up to 4 events per channel, drawn from STOP, START, unsubscribe link, one-click unsubscribe, web/portal opt-out, operator opt-out, bounce, complaint, DNC add and documented re-consent. Invariants: appending an opt-out never makes a send allowed; START makes a send allowed only when the latest blocking event is a STOP and consent was on record before it; START never lifts DNC, bounce, complaint, unsubscribe, web/portal or operator opt-outs; no event deletes or relabels an earlier opt-out. |
| Questions | Confirm migrations 138–141 are safe to apply while current production code runs; name what in the repo applies migrations to production; list everything that would send if `marketing_automation` were turned on today, with every campaign's current state; how production was read; what was found about the unmatched Resend sender. |
| Canary contacts | **UNANSWERED** — both arrived as blank placeholders again (`+1 [___-___-____]`, `[___@___]`). No live send is possible. |
| `CRON_SECRET` (Vercel Production) | **UNANSWERED** — the reply kept the template text `[set \| not set yet; I'll set it before merging]`. Merge stays blocked on it. |
| `SMS_A2P_APPROVED` (Vercel Production) | **UNANSWERED** — `[value]` placeholder. |

### Round 3 (owner, 2026-10-04)

| # | Decision |
|---|---|
| Finding 5 | **Explicitly approved cron change.** Run the five dispatch crons (`campaign-dispatch`, `district-nurture-tick`, `life-conversion-tick`, `pipeline-winback-tick`, `cross-sell-life-tick`) **hourly from 17:00 to 23:00 UTC**, with the guard of **at most one touch per enrollment per day**. If a sequence sends SMS and email on the same day by design, apply the guard **per channel**. If the `vercel.json` edit is still refused, put the exact diff in the PR description for the owner to apply. |
| START after re-consent | **Yes.** A documented re-consent on a channel, from a source that counts as consent today, clears the earlier opt-outs on that channel; from then on START works normally for any later STOP. START on its own still never lifts a non-STOP opt-out. **Hard bounces are not consent:** they clear only when the address is verified again. Add these cases to the property test. |
| AI opener to non-US numbers | **Block it** unless the FSA sees the exact message and presses send. AI text that goes out without that review is automated. Confirm AI-drafted openers pass the no-recommendation check before the FSA sees them. |
| Before merge | (1) `docs/ops/migration-runbook.md` (no PII) for the owner to run. (2) A deploy-impact list: everything that will send in the first 24 h after deploy (CRON_SECRET set, production as now), with counts and triggers, plus what sends today and will stop or change. (3) Booking notices and briefings with no FSOS message record must go through the gated send path and write one. (4) 3b counts for every store an automated text can resolve a recipient from, per store. (5) Whether the opt-out writers serialize concurrent events for one address, or the race window. |
| Canary | The owner verified their phone and email in `/app/comms`. **The verified `comms_test_recipients` entries are the canary set**; their values are never copied anywhere. |
| Owner-run | The owner runs the browser checks locally and sets `CRON_SECRET` and `SMS_A2P_APPROVED` themselves. When CI is green on the final head, mark the PR ready for review. **Do not merge.** |

## 1c. Round 3 — what was implemented, and the answers (2026-10-04)

| Item | Status | Commit |
|---|---|---|
| Finding 5 — cron move | **Done.** `vercel.json`: the five dispatch crons run at `0 17-23 * * *`. Every hour in that range is inside 09:00–20:00 in every continental zone, standard and daylight. `gate.ts oneTouchPerDay` holds each enrollment to one touch per UTC day. No engine schedules two touches on one day, and each drip is single-channel, so the guard is also per channel. Regression: `cron-send-window`, `automation-wiring`. | `e052837` |
| AI opener to non-US | **Done.** Only an opener the FSA **typed** is operator-initiated. A seeded campaign asset is rendered server-side and may never have been previewed, so it is automated (US only). The AI replies that follow are automated. | `ebdd2a0` |
| Single send path | **Done.** The booking fallback notices, FSA alerts, visitor acks, the morning briefing and the form-link email now go through `sendMessage` and write a message record (see below). | `3d22208` |
| START after re-consent | **Done, narrowed after review.** The signed-in client's own portal re-consent clears earlier opt-outs on the channel, except a hard bounce; START then works normally. Public form/booking opt-ins do not clear (review F1). Property test I5, I6. | `59e3f37`, review fixes |
| Concurrency | **Closed with compare-and-set writes; the remaining window is documented below.** | `6043925` |
| Migration runbook | [`migration-runbook.md`](migration-runbook.md) | docs commit |

### No model drafts an AI opener, and every AI draft passes the red line before the FSA sees it

- The console's conversation opener is FSA-typed text or an approved campaign asset. No model
  writes it (`console-workbench.tsx` → `/api/comms/conversations/start`).
- Model-written text reaches the FSA only as a **held draft**: an inbound auto-reply that the gate
  withheld at `ai_authority` (`send.ts`). Two checks run first:
  - the responder screens the model output with `containsRecommendationLanguage` and replaces a
    flagged draft with a hand-off (`ai/responder.ts`);
  - the gate's recommendation step (step 5) runs before `ai_authority` (step 6c), so a draft with
    recommendation language is blocked there and never recorded as an FSA draft.
- **So every AI draft the FSA sees has passed the no-recommendation check twice.**

### Single send path: what had no FSOS message record, and what changed

- **Production evidence:**
  - no outbound `comm_messages` row has been written since 2026-08-26;
  - booking notices kept going out in September (`system:notify`, entity `appointment`);
  - of the 118 unmatched Resend sends, 12 matched FSOS audit rows: 11 booking notices and 1
    briefing.
- **Cause:**
  - The booking **fallback** used while appointment email templates are unapproved, the FSA alerts
    and the visitor acks (`notifications/transactional.ts`), the briefing route and the form-link
    email called `messaging.sendEmail` directly. That path is gated at the chokepoint, but it
    writes no record.
  - There is no `sendThroughGate` any more. Its successor is `sendMessage` (`comms/send.ts`),
    which writes the record and then calls the chokepoint.
- **Change:** all of them now go through `sendMessage` via `sendRecorded`.
  - The record is written against the entity when it has a uuid id (appointment, form submission).
    The briefing has no row of its own, so its record stands alone (`entity_type 'message'`).
  - Narrow options keep each delivered email as before: `replyTo` is kept, `track:false` adds no
    open/click pixel, `thread:false` opens no conversation (so the collision and reply rules never
    see it), and `listUnsubscribe:false` adds **no** List-Unsubscribe header. A one-click
    "Unsubscribe" on an FSA alert would put the practice's own inbox on DNC and block every later
    alert. The only header added is `X-FSOS-Message-Id`.
  - The bodies are already rendered and carry visitor-typed text, so `{{` is neutralized before
    personalization: a typed `{{word}}` is neither substituted nor able to block the alert.
  - `result.id` is now the FSOS message id, not the Resend id (the briefing API's `email_id` and
    the form-link log line carry the FSOS id).
- **Not moved: the password-setup email.** Its body is a one-time credential link, which must not
  be stored in a message record. It stays on the gated direct path.
- `jobs/agent-runner.ts` has a direct `dispatch` hook with no record, but **no caller uses it**
  (the workforce sends through `sendMessage`). Recorded here, not changed.

### Re-consent (owner decision, round 3)

- **What clears.** A documented re-consent on a channel clears the earlier opt-outs on that
  channel. **Only the authenticated client portal clears, and only for the signed-in client's own
  address** (the household member whose email is the signed-in user's). Narrowed after review — see
  "Adversarial review of round 3" below:
  - the public contact-form and booking SMS opt-ins **do not clear**: nothing ties the submitter
    to the handset, so a stranger could clear someone else's STOP. They still record a grant; the
    person re-opens SMS by texting START, which lifts a keyword STOP as before;
  - a portal grant by one household member does not clear another member's opt-out.

  Each lift is audited through `recordConsentChange` (audit log + timeline). A row armed after the
  re-consent started is never lifted.

  DNC rows are **lifted** (`lifted_at`), never deleted or relabelled. A row carrying a **hard
  bounce** stays active; no code path re-verifies an address today, so a bounce clears only by an
  operator action outside FSOS.
- **Channel-wide web opt-outs.** A web opt-out recorded for **all channels** is split on an SMS
  re-consent: the email side gets its own row with the same reason, then the all-channel row is
  lifted.
- **START after re-consent.** START judges only the opt-outs after the latest **clearing**
  re-consent (the portal grant, `consent_version 'reconsent'`), plus any hard bounce ever. A public
  opt-in does not move that window. START alone still never lifts a non-STOP opt-out.
- **Not a clearing source:**
  - **Workshop-registration consent** is scoped to that workshop's reminders
    (`workshop_consent_events`), not channel consent at the gate.
  - A bare **email** contact has no documented-consent source in FSOS, so nothing clears an email
    opt-out for a non-member.
  - For an existing **member**, a booking SMS opt-in clears nothing; START from the handset (or the
    member's own portal grant) restores.

### Adversarial review of round 3 — findings and fixes

A fresh reviewer (no repairs written) reviewed `994fa05..2b2e705`. Each fix has a regression test
that fails without it.

| # | Finding | Fix | Regression |
|---|---|---|---|
| F1 (P0) | A stranger could clear someone's STOP through the public contact form or booking opt-in (unverified number), and automated SMS would resume. | Public sources no longer clear. Only the signed-in client's own portal grant clears. | property test I6 + "booking opt-in after a STOP" case; `booking-sms-consent` |
| F2 (P1) | A portal grant cleared every household member's STOP / unsubscribe. | Clears only the member whose email is the signed-in user's; no unique match → nothing cleared. | property test "household member's portal grant" case |
| F3 (P1) | The briefing could never send: it wrote a date into the uuid `comm_messages.entity_id` (live column type confirmed read-only: `uuid`), so the record failed and the send was withheld. | The briefing passes no entity; `sendRecorded` forwards only uuid entity ids. memdb now rejects a non-uuid `entity_id` like Postgres. | `transactional-notifications` |
| F4 (P1) | A visitor-typed `{{word}}` blocked the FSA lead alert and the visitor ack (or substituted the FSA's own unsubscribe link). | `{{` neutralized in `sendRecorded` bodies. | `transactional-notifications` |
| F5 (P2) | FSA alerts gained a one-click List-Unsubscribe; one click would DNC the practice inbox and block every later alert and briefing. | `listUnsubscribe:false` for `sendRecorded`; every other send unchanged. | `transactional-notifications` |
| F6 (P2) | Member: booking opt-in after STOP lifted the DNC, leaving START unable to restore member consent. | Gone with F1 (booking clears nothing); START restores. | property test case |
| F7 (P2) | Admin resume / replay / restart set `next_touch_at` to today, so an hourly tick could send a second touch the same day. | Each engine tick checks for a touch already **sent** today (UTC) before claiming; if so it moves `next_touch_at` to tomorrow. A read error holds the touch. | `cron-send-window` |
| F8 (P2) | A re-consent lift wrote no audit entry. | Every lift goes through `recordConsentChange`; a failed audit returns `ok:false` (portal answers 500). | — (code path; audit seam stubbed in tests) |
| P3 | `cleared` over-counted; a STOP between grant and lift could be lifted; wrong error text; unthreaded records labelled `conversation`; forms log called the FSOS id a Resend id. | Lift is `.select('id')`-counted; rows armed after the re-consent are skipped; error text fixed; label `message`; log fixed. | property test |

Not changed (P3, recorded): legacy DNC rows from before revoke evidence, where a hard bounce
re-armed a row first created for another reason, carry no `hard_bounce` evidence; a portal email
re-consent would lift them (depends on legacy data). Splitting an `'all'` row keeps sms/email but
not a `'call'` reading of it (display readers ignore `lifted_at` anyway). Drips with `delay_days ≥ 1`
can drift by up to an hour per step. Migration 138's column comment still says unsubscribe rows are
never lifted; changing it needs a new migration.

### Concurrency: do the opt-out writers serialize?

**No.** Each writer is several PostgREST statements with no transaction or row lock. Postgres
serializes each single-row update and the `unique (contact, channel)` insert, and nothing more.
What closes the windows (`6043925`):

| Race | Before | Now |
|---|---|---|
| START lifts while an opt-out re-arms the same row | The lift could land after the re-arm and undo the opt-out. | The START lift is **compare-and-set on `created_at`**. A re-arm after START's read makes the lift a no-op. |
| START lifts between an opt-out's evidence write and its re-arm, or the clocks of two serverless instances disagree | The opt-out's re-arm could carry an older timestamp than the lift. | The re-arm takes a fresh timestamp after the evidence, then **re-reads the row**. If it is still lifted, `created_at` is pushed past `lifted_at`. |
| A re-consent races an opt-out | The opt-out's evidence could predate the grant, so a later START ignored it. | The re-consent lift is compare-and-set on `created_at` and skips any row armed after the re-consent started. After its re-arm, the opt-out checks for a grant captured since its evidence and appends **fresh evidence** if there is one. |
| START restores member consent while an operator or portal revoke lands | The upsert overwrote the later revoke. | The restore is **compare-and-set** on the STOP's own revoke (`status='revoked'` and the STOP's `source`). |

**Remaining window.** Between an opt-out's post-check read and the end of its function, a START
could read the row, see only keyword evidence and lift it. This requires an opt-out and a START
from the same person within milliseconds. The opt-out's evidence is already written, so any later
START or re-consent decision sees it. The STOP/START window closes fully only with a single
database function holding a row lock; that is a new migration and was not added. Each webhook
retries on 5xx, and every write is idempotent.

### The 3b counts per store (every store an automated text can resolve a recipient from)

Production, read-only, 2026-10-04. Phones were classified with the code's own lists.

| Store | Rows | With a phone | US, zone from area code | US, zone unknown | Non-US | Country not establishable |
|---|---|---|---|---|---|---|
| `household_members.phone` (campaigns, drips, workforce) | 4 | 4 | 4 | 0 | 0 | 0 |
| `contacts.phone` (booking, Win-Back contacts) | 4 | 4 | 4 | 0 | 0 | 0 |
| `comm_conversations.contact` — SMS threads (AI replies; **the 143 Win-Back threads are 109 SMS + 34 email**) | 109 | 109 | 109 | 0 | 0 | 0 |
| `comm_messages.recipient` — outbound SMS history | 84 | 83 | 83 | 0 | 0 | 0 |
| `comm_contact_consents` — SMS | 8 | 8 | 8 | 0 | 0 | 0 |
| `referrals.referred_phone` (workforce referral follow-up) | 8 | 6 | 5 | 0 | 0 | 1: `26f8f8de` |
| `agency_referrals.client_phone` | 1 | 1 | 1 | 0 | 0 | 0 |
| `workshop_registrations.phone` (workshop engine) | 4 | 4 | 2 | 0 | 0 | 2: `047a18f9`, `53585032` |
| `customers.phone` / `cell_phone` (legacy campaign run) | 1 / 1 | 1 / 0 | 1 / 0 | 0 | 0 | 0 |
| `district_nurture_enrollments`, `agency_owners` (district nurture) | 0 | 0 | — | — | — | — |
| Imported books: `ghl_upload_rows`, `conv_stage`, `form_responses` | 0 | 0 | — | — | — | — |
| Not recipient sources, counted for completeness: `agencies.phone` (4 US); `ffs_contacts` (FFS staff directory: 4 US, 1 not establishable) | | | | | | |

Win-Back and cross-sell imports land in `contacts` / `household_members` (`import_records` holds
no phone), which are counted above. **Unknown zone: 0. Non-US: 0 in every store.**

### Workshop reminders "never ran" — the real cause

`CRON_SECRET` being set is not the cause. What production shows:

- **Crons are being invoked.** Every `/api/cron/[job]` cron has `job_runs` rows up to today, on
  schedule.
- **The workshop route keeps no run log.** It does not use `job_runs`, and a run with nothing to
  do writes nothing. A pass that runs and finds nothing is therefore invisible. The Vercel runtime
  logs that would show the invocations are not readable from this session (403).
- **Its only trace is one run on 2026-08-30 14:01 UTC.** All three passes failed in 0.4 s on
  `column workshop_sessions.cadence_generation does not exist`. Migration 130's column was not yet
  in production; it is there now.
- **There has been nothing to send since the cron was added (2026-08-25).**
  - Both production workshop sessions started on 2026-07-28 and 2026-08-14.
  - The reminder pass looks 8 days ahead and has had no upcoming session since.
  - The nurture pass looks 14 days back, so after 2026-08-28 no session qualified.
  - No session has been rescheduled or cancelled, so the change pass has had nothing either.
  - `workshop_message_log` has 0 rows.

**Does this branch change it?** The route's auth is the same Bearer check, now shared
(`cronAuthorized`). The engine now fails closed on an unreadable config. **After deploy it still
sends nothing** until a workshop session is scheduled with registrations. The registration
acknowledgement is also blocked until its template (`eeee0000…ac01`, status `submitted`) is
approved.

**One thing to note.** The two registrations whose phones cannot be shown to be US (`047a18f9`,
`53585032`) would now get no workshop SMS (3b).

### Deploy impact — the first 24 hours after deploy

Production as of 2026-10-04: `CRON_SECRET` set, `SMS_A2P_APPROVED = true`, and `marketing_automation`
enabled.

| What | Trigger | Expected in 24 h |
|---|---|---|
| Booking reminders (SMS + email) | `booking-reminders`, every 15 min | **0**: no future appointments. Email needs booking-email consent. SMS needs an SMS opt-in, a US number, the floor and an approved template (12 booking SMS templates are approved). Only the 24 h offset runs until 137 is applied. |
| Booking confirmation / reschedule / cancel | a booking event | About 1 booking a month. The SMS goes if the booker ticked the SMS box and the number is US. The email goes through the transactional **fallback** (email templates unapproved), **now recorded**. Plus 1 FSA alert. |
| Contact-form acknowledgement + FSA alert (email) | a form submission | About 1 a month, now recorded. |
| Inbound replies: HELP (TwiML), STOP/START, AI auto-reply | an inbound text | 0 inbound in the last 30 days. 3 AI-armed threads (2 SMS) would auto-reply through the gate if the person writes. |
| Workforce `referral_followup` | `workforce-orchestrator`, 15:00 UTC | **0**: no referral under 14 days. The other three agents stand down. |
| Life Conversion, Win-Back, Cross-Sell, District nurture | ticks, hourly 17–23 UTC | **0**: paused or draft. |
| Broadcasts and drips | `campaign-dispatch`, hourly 17–23 UTC | **0**: no active campaigns, sequences or enrollments. |
| Workshop reminders, changes, nurture | `workshop-reminders`, every 15 min | **0**: no sessions in the reminder or nurture windows. |
| Retry sweeps | hourly at :30 | **0 sends**: reconcile only; re-dispatch switch off. |
| Social publishing | every 5 min | **0**: no entries. |
| Operator sends (console, conversation reply/start, test sends, form links, briefing) | a person | As used. Briefing has no cron. |
| Password-setup email | user provisioning | As used. |
| The 80 unattributed Resend sends | not FSOS (§1b) | Continue regardless of this deploy (71 in the last 30 days, including FSOS's). |

**Today vs after deploy — what stops or changes:**

| Today (`main`) | After deploy |
|---|---|
| Workforce `term_conversion` / `cross_sell` / `life_winback` would send if their audiences had consent | Stand down; the campaign engines own those audiences. |
| Booking fallback, FSA alerts, visitor acks, briefing, form-link emails send with no FSOS record | Same emails, now recorded (no thread, no tracking, no List-Unsubscribe). |
| Automated SMS to a non-US or non-establishable number (none exist) | Hard-blocked. |
| A typed opt-out on the web page stored as typed (mixed case / punctuation never matched) | Normalized; it blocks. |
| A later opt-out relabelled an earlier one; START could undo an operator opt-out | Never relabelled; START respects every non-STOP opt-out. |
| Re-consent never cleared a STOP/unsubscribe | The signed-in client's own portal re-consent clears (not hard bounces). Public form and booking opt-ins do not clear. |
| Reminder SMS could land in quiet hours | Moved inside the floor, or skipped. |
| Dispatch ticks at 12:00–16:00 UTC | Hourly 17:00–23:00 UTC, one touch per enrollment per day, also after an admin resume or restart. |
| `x-vercel-cron` header alone authorized `/api/cron/[job]` | Bearer `CRON_SECRET` only (set). |

**Canary set: empty in production.** `comms_test_recipients` has **0 rows** (read 2026-10-04,
counts only). The phone and email you verified in `/app/comms` are not in this database; they may
be on a preview or local database. Canary mode for both switches therefore matches nobody until
they are verified on production. Their values were not read or copied.

## 1b. Round 2 — what was implemented, and the answers

| Item | Status | Commit |
|---|---|---|
| Finding 3a — both zones | **Done.** The address zone stays primary; a resolved area-code zone that differs is evaluated as a second instant, so the send must be inside the floor (and the Sunday hold) in both. Both zones are recorded on the send. Regression: `tests/dispatch-chokepoint.test.mjs` (the new cases fail on the previous source). | `e66eeca` |
| Finding 3b — US only | **Done.** New gate step `non_us_recipient` (hard, escalating, after consent). CLAUDE.md updated. Regression: `tests/recipient-country.test.mjs`. | `402cd60` |
| Opt-out property test | **Done; it found two defect classes, both fixed** (below). `tests/optout-consent-property.test.mjs`: 88,880 sequences, 168,872 invariant checks, about 17 s. | `2c982ea` |
| Finding 5 — cron move | **Not done: blocked.** The session's permission classifier refused the `vercel.json` cron edit; cron changes are also on the brief's hard-stop list. Needs your explicit go-ahead on the exact schedule (below). | — |

### Finding 5: the schedule I propose, pending your go-ahead

- **The Vercel plan allows hourly crons.** `vercel.json` on `main` already runs `referral-sla` hourly, the four retry sweeps
  at `:30` every hour, and three crons every 5–15 minutes. Deployments with those crons succeed: the Vercel check on
  this PR is green. Vercel Hobby rejects sub-daily crons (ASSUMPTION from Vercel's documentation; I cannot read the
  plan: the Vercel connector has no access to the project).
- **Proposed:** run `campaign-dispatch`, `district-nurture-tick`, `life-conversion-tick`, `pipeline-winback-tick` and
  `cross-sell-life-tick` **hourly from 17:00 to 23:00 UTC** (`0 17-23 * * *`), not round the clock.
  - Every hour in that range is inside 09:00–20:00 in every continental zone, in both standard and daylight time.
    Hours outside it would only produce quiet-hours holds, and each one escalates.
  - Within the range, a touch held on a Sunday morning or by an operator window is released the same day, not
    the next day.
- **One guard ships with it:** at most one touch per enrollment per UTC day.
  - Today the daily cron gives that for free. Hourly runs would let a touch released from a hold fire, and the
    next overdue touch fire an hour later.
  - The guard sets the next due time to no earlier than the start of the next UTC day, in each engine's cursor
    advance and in the drip advance.
- If you prefer plain daily `0 17 * * *` for the three ticks, exactly as written in finding 5, no guard is needed.

### Finding 3b: interpretation and what changes

- **"Automated"** means every SMS except one a person starts from an operator surface: the console 1:1 send, a
  conversation reply, conversation start, test sends, and the staff form link. Those set `operatorInitiated`; a
  static check pins that list. Anything that omits the flag is treated as automated (fail closed).
- **Blocked:**
  - non-+1 numbers;
  - Canadian +1 area codes, including the non-geographic 600/622/633;
  - the Caribbean and Bermuda +1 codes;
  - +1 numbers whose country cannot be established: toll-free and other non-geographic codes, and unparseable
    values.
  The non-US list is taken from libphonenumber-js 1.13.14 metadata. One gap can let a send through: a newly assigned
  Canadian or Caribbean code that is not on the list reads as US. It is then held to the continental window, not
  blocked. Refresh the list when NANPA announces new codes.
- **US territories are the US:** PR 787/939, USVI 340, Guam 671, CNMI 670 and American Samoa 684 resolve to their own
  zones.
- **A behaviour change to note:** automated appointment SMS (booking confirmations and reminders) to a Canadian
  booker are now blocked too. The booking email still goes.

**How many contacts resolve to unknown or non-US today.** Production, read-only. Phones were classified with the
code's own lists; only ids and categories were read.

| Store | Rows with a phone | US, zone resolved | US, zone unknown (decision 1) | Non-US | Country not establishable |
|---|---|---|---|---|---|
| `household_members` (with household ZIP) | 4 | 4 | 0 | 0 | 0 |
| `contacts` (with own ZIP) | 4 | 4 | 0 | 0 | 0 |
| `referrals.referred_phone` | 6 | 5 | 0 | 0 | 1: `26f8f8de` (toll-free or fictional area code) |
| `workshop_registrations.phone` | 4 | 2 | 0 | 0 | 2: `047a18f9`, `53585032` (11 digits, not a valid +1 form) |
| `comm_contact_consents` (SMS) / `comm_conversations` (SMS) | 8 / 109 | 8 / 109 | 0 | 0 | 0 |
| `agency_referrals`, `customers` | 1 / 1 | 1 / 1 | 0 | 0 | 0 |

**Unknown zone: 0. Non-US: 0. Not establishable: 3** (ids above). `agency_owners`, `district_nurture_enrollments`
and `form_responses` hold no phones.

### What the property test found, and the fixes

Two defect classes. Both are event-ordering bugs, and neither appeared in the example tests.

1. **Every DNC writer relabelled an earlier opt-out (I4).** The upsert overwrote `reason`. Affected writers:
   - the STOP writer, including STOP → STOP;
   - unsubscribe link and one-click;
   - web and portal opt-out;
   - bounce and complaint, which relabelled each other;
   - DNC add.

   **Fix:** one shared writer, `armDncEntry` in `src/lib/comms/opt-out.ts`. It inserts only if absent, then only
   re-arms `created_at`. It never touches an existing reason and never deletes. Every non-keyword SMS or email
   opt-out now also appends contact-level revoke evidence (append-only, written before the re-arm and checked).
   'call'-channel opt-outs write none; START never touches them.
2. **START undid an operator opt-out (I2/I3).** Sequence: STOP, then operator opt-out, then START.
   - The operator's bulk revoke skipped the member as "already revoked", so it recorded nothing.
   - START then restored the member grant documented before the STOP.

   **Fix:**
   - The operator revoke always appends revoke evidence.
   - START lifts a STOP-labelled DNC row only when all revoke evidence for the address comes from keyword opt-outs.
   - START restores member consent only while the STOP's own revoke is still the member's latest state.

**Also fixed, pinned in the same test:** the web opt-out stored the address as typed. A mixed-case email or a
punctuated phone therefore never matched the send. It is now normalized exactly as the gate reads it.

**Two interpretations of the invariants, written into the test header:**
- "Consent on record" for I2 means a grant before the STOP, or a documented re-consent after it. START itself never
  creates one.
- A documented re-consent supersedes an operator opt-out, because it re-grants the member store. It does not lift a
  DNC-based opt-out: no code path does, by decision 4.

**Not changed (policy, for you):** a documented re-consent after a DNC-based opt-out (unsubscribe, web/portal,
bounce, complaint, DNC add) never takes effect. No path lifts that DNC row. That is over-restrictive, not a
send-when-shouldn't.

### Round-2 adversarial review (fresh reviewer that wrote none of it)

**No P0. One P1, fixed.**

| # | Sev | Finding | Disposition |
|---|---|---|---|
| R1 | P1 | The web opt-out's evidence insert was unchecked. If it failed, the route answered 200, and a later START could lift the STOP-labelled row the opt-out had re-armed. Reproduced. | **Fixed:** the insert is checked, and a failure answers 500 so the person retries. Regression added to the property test (injected write failure). |
| R2 | P2 | Race: the re-arm ran before the evidence insert, so a START between the two could lift a fresh opt-out. | **Fixed:** evidence is written before the re-arm. Pinned in `comms-optout-rearm`. |
| R3 | P2 | A portal revoke whose DNC write failed returned before auditing that member, and skipped the rest of the household. | **Fixed:** every member is processed and audited, then the request fails with 500. |
| R4 | P2 | After any non-keyword revoke, START stays disabled for the address, even after documented re-consent (e.g. operator opt-out → re-consent → STOP → START stays blocked). | **Left as is: fails closed.** Owner decision: should a documented re-consent re-enable START for a later STOP? START support is an A2P expectation. |
| R5 | P3 | On a phone/ZIP disagreement, the send record used a different format from migration 124's documented `'<npaZone>+<zipZone>'`, method `both`. | **Fixed:** recorded in the documented form; both zones are still evaluated. |
| R6 | P3 | Operator revoke evidence is keyed by address, so household members sharing a phone or email inherit it. | Left as is: over-blocks, never sends. |
| R7 | P3 | The bulk revoke threw before its summary audit when evidence failed. | **Fixed:** the summary audit records the error, then it throws. |
| R8 | P3 | Reserved Canadian non-geographic codes 644/655/677/688 were not listed. | **Fixed:** added; listing a reserved code costs nothing. |
| R9 | P3 | `sendForm` hard-coded `operatorInitiated`, and a public caller (agency referral intake) shares it. | **Fixed:** only the staff route passes it; the public caller is pinned not to. |
| R10 | P3 | `conversations/start` sends an AI-drafted opener as operator-initiated, so it can reach a non-US number. | **Owner question.** The operator picks the recipient and starts it; the AI replies that follow are automated and blocked. |

Areas the reviewer checked and found sound:
- 3a: the address zone is never dropped.
- 3b classification: no US number misclassified; territories are US.
- No automated path sets `operatorInitiated`.
- `armDncEntry` against the unique key and `all` rows.
- The rewritten tests are not weakened.
- The property test is not vacuous.
- The CLAUDE.md paragraph matches the code.

### Are migrations 138–141 safe to apply while current production code runs?

**Yes for 138, 140 and 141. 139 is safe, but better applied with the deploy.** Traced against `main`; nothing was
applied anywhere.

| Mig | What it does | Effect on the code running today (`main`) |
|---|---|---|
| 138 | adds nullable `dnc_entries.lifted_at`, `lifted_reason` | None. `main` never reads them. Metadata-only `ALTER`, brief lock. |
| 139 | sets `purpose = 'MARKETING'` on `life_campaigns` and `xsell_life_campaigns` | Production today: Life Conversion `POLICY_DEADLINE`, Cross-Sell `CLIENT_CARE_CROSS_SELL` (an invalid purpose, so every `main` cross-sell send is blocked). After 139 on `main`, Life Conversion gets the stricter marketing treatment, and **Cross-Sell becomes sendable under `main`'s unrepaired engine** if someone unpauses it. Both are paused with 0 enrollments, so nothing changes today. Apply 139 with or after the deploy, and keep both paused until then. |
| 140 | new `automation_switches` table, RLS, `callback_engine_state` = off | None. `main` does not read it. |
| 141 | seeds `engine_retry_redispatch` = off | None. |

**Ledger gaps (production `schema_migrations`):**
- 131 files are recorded, the last on 2026-08-31.
- 128–134 are **not recorded, but their objects exist**: applied out of band.
- **137 (`booking_reminder_cadence`, already on `main`) is not applied.** `offsets_minutes` still defaults to
  `{1440}`.
- Apply 137 before or with 138–141. The ledger should be reconciled, but that is a production write; it is not done.

### What in the repo applies migrations to production

**Nothing automatic.**
- `npm run migrate` (`scripts/migrate.mjs`) applies `supabase/migrations/*.sql` through `psql`, but only when someone
  runs it with `DATABASE_URL` set. It records each file in `schema_migrations`.
- `.github/workflows/ci.yml` never applies migrations:
  - it proves the chain on an ephemeral Postgres;
  - its production drift check is read-only and unarmed (no `DATABASE_URL` secret).
- **Outside the repo,** the Supabase GitHub integration is connected:
  - it posts the "Supabase Preview" check;
  - the `main` branch record is `MIGRATIONS_FAILED`, last updated 2026-09-03;
  - the Supabase-side ledger (`list_migrations`) holds only 14 entries.
  Whether that integration deploys migrations to production on merge is a dashboard setting I cannot read. Check
  it before merging, or a merge could attempt to apply the whole chain.

### If `marketing_automation` were turned on today

**It already is on.** `ai_agents.marketing_automation.enabled = true` and the AI gateway is enabled. The §4 note
saying it is seeded disabled described the migration default, not production; corrected below.

What the switch gates:
- **On this branch:** only `campaign-dispatch`, meaning broadcasts and drips.
- **On `main`, which is running now:** nothing. `campaign-dispatch` does not read it (C-05).
- The engine ticks (Life Conversion, Win-Back, Cross-Sell, District nurture) send as `agent:marketing_automation`
  but are gated by their own campaign status, not by this switch.

Every campaign, as read from production:

| Campaign | Engine | Status | Purpose | Enrollments (live) | Would send today? |
|---|---|---|---|---|---|
| Life Conversion Campaign `f1c00000` | life tick | **paused** | `POLICY_DEADLINE` (→ MARKETING with 139) | 0 (0) | No: paused |
| Win-Back Campaign `e2f00000` | win-back tick | **paused** | MARKETING | 0 (0) | No: paused |
| Cross-Sell Life `f5c00000` | cross-sell tick | **paused** | `CLIENT_CARE_CROSS_SELL` (invalid; → MARKETING with 139) | 0 (0) | No: paused |
| The Second Conversation `d1a00000` | district nurture tick | **draft** | MARKETING | 0 (0) | No: draft |
| 4 engine-registry rows in `comm_campaigns` | campaign-dispatch | paused, **archived** | — | 0 | No: not active |
| Broadcasts / drips | campaign-dispatch | 0 active campaigns, 0 sequences, 0 enrollments | — | — | No |
| Legacy `campaigns` (`/api/campaigns/run`) | manual | 0 rows | — | — | No |

**Nothing would send because of `marketing_automation`.** What can send today without any switch change is the list
in §6, mainly booking notices and operator sends.

### How production was read

Unchanged from §6:
- **Tool:** the claude.ai Supabase connector (`execute_sql`, `list_migrations`, `list_branches`), project
  `ynxaqeejjmeilpwmuuie`.
- **Credential:** its OAuth link through the Vercel-marketplace Supabase organization. No key was handled in this
  session.
- **Database role:** `postgres` (`rolbypassrls = true`, not superuser).
- **Can it write?** Yes; the path itself is not read-only.
- **How it was used:** every statement in both rounds was a SELECT inside `begin read only … commit`. Only aggregates,
  ids (first 8 characters) and configuration were returned.

### The unmatched Resend sender

`comm_message_events` holds **118 email sends with no FSOS message record**:
- 27 Jul to 2 Oct; the latest arrived today, 15:40 UTC;
- each has one `sent` and one `delivered` event; **0 bounces, 0 complaints**;
- **none** matches a `comm_messages` row.

Matching against FSOS's own activity:

| Bucket | Sends | What it is |
|---|---|---|
| Provider id found in FSOS's audit log | 12 | 11 booking appointment notices (`system:notify`), 1 morning briefing |
| FSOS `comms.*` audit row within 2 min | 1 | a booking notice |
| An appointment created within 3 min | 22 | very likely FSOS booking notices or FSA alerts sent without an audit row (ASSUMPTION) |
| A Supabase Auth event within 3 min | 3 | likely Supabase Auth email (invite / recovery / sign-in) sent through Resend SMTP (ASSUMPTION) |
| No FSOS activity at all | **80** | **sender unidentified** |

The 80 cannot be attributed without the Resend dashboard (sending domain, `from` address and API key per message).
No Resend connector is available.

**What this means for clients:**
- Every FSOS email path goes through `sendEmail`, so an FSOS send cannot bypass the gate.
- If the 80 come from another application or key on the same Resend account, they are outside FSOS's gate entirely.
  Per your earlier decision, if they reach clients that is P0.
- **Next step:** in Resend, filter those days' sends by API key and domain.

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
2. Apply **137** (on `main`, not yet in production), then migrations **138, 139, 140, 141** before or with the code
   (139 with or after it — §1b). Check first whether the Supabase GitHub integration deploys migrations on merge (§1b). Each is additive or a config row and carries a
   `-- ROLLBACK:` block, proven on real Postgres by `tests/automation-migrations-rollback.test.mjs`. Roll back 141
   before 140. The code is safe without 138 (no row ever reads as lifted) and without 140/141 (a missing switch row is
   off).
3. `marketing_automation` is seeded disabled by migration 010, **but production has it enabled** (read 2026-10-02, §1b).
   On this branch, broadcasts and drips run only while it stays enabled; today there is nothing for them to send.
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
- **GitHub Actions `verify`** (CI: type-check → lint → test → build → `test:rls`) passed on `b161511`. The first attempt
  failed inside `next/font` while fetching Google Fonts; nothing in this PR touches fonts. One re-run passed.
- Fail-before / pass-after: for most Phase C–E repairs, the new test was also run against the pre-change source and
  failed there. Not every Phase A/B test was re-checked that way.

**BROWSER-VERIFIED:** none.

**NOT VERIFIED, and why:**

- **Rendered UI.** Every surface changed is behind auth. A local Supabase stack could not start: Docker started, but
  image pulls failed (Docker Hub 429; ECR/GHCR blob hosts Forbidden through the session proxy). No Playwright session
  ran, so the UI changes are source-verified only.
- **Live provider behaviour** (canary checks C1–C10, inventory §9). The canary contacts were blank placeholders.
- **Production env values** (`SMS_A2P_APPROVED`, `CRON_SECRET`, Preview env). The Vercel connector has no access.

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
| 3a | P2 | Phone/ZIP zone disagreement: the ZIP zone alone now governs. The earlier flag-on mode required both. | **Decided (round 2): both zones. Fixed** `e66eeca`. |
| 3b | P2 | An unresolved zone now sends inside the continental intersection; Alaska/Hawaii/foreign numbers are not covered. CLAUDE.md still describes a hard block. | **Decided (round 2): decision 1 kept for US numbers; non-US is a hard block. Fixed** `402cd60`; CLAUDE.md updated. |
| 4 | P2 | A broadcast's quiet-hours hold never expired (due = now). | **Fixed** `37d495d`: bounded from `schedule_at`, else `created_at`. |
| 5 | P2 | The Life / Win-Back (15:00 UTC) and Cross-Sell (16:00 UTC) ticks fall before 09:00 Pacific and Arizona, and are never inside the window for unresolved zones. With decision 2 those SMS touches are held each day, escalated, and written off after 72 h. | **Approved (round 2), not yet applied:** the cron edit was refused by the session's permission controls; schedule awaiting confirmation (§1b). Still pinned in `tests/cron-send-window.test.mjs`. |
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

- set `CRON_SECRET` (still UNANSWERED);
- apply 137, then migrations 138–141 (§4);
- confirm the finding-5 schedule (§1b); 3a and 3b are implemented;
- check whether the Supabase GitHub integration deploys migrations on merge (§1b);
- identify the 80 unattributed Resend sends in the Resend dashboard (§1b);
- answer the open questions in §5;
- provide verified canary contacts (still blank);
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
