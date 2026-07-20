# GHL Workshop Workflows — P2 Build Sheet (manual runbook)

> **Purpose.** GoHighLevel workflows are **created and confirmed by hand in the GHL UI** — they
> are *not* API-creatable (`docs/ghl_integration.md §3`; the "45 workflows" WF-0…WF-43 are
> triggered by **tag / pipeline / lead_source**, and the binding contract is that trigger, not
> an API call). This document is the human build sheet for the Workshop/Seminar P2 workflows.
> Build each workflow below exactly as specified, then flip it live.
>
> **Two dispatch paths, by design (spec §7).** FSOS already runs a **native** reminder + nurture
> engine through its own gated dispatcher (`/api/cron/workshop-reminders` → `dispatch()` →
> `gate.ts`; consent + DNC + quiet-hours enforced in code). The GHL workflows below are the
> **parallel channel**: they fire off the **tags FSOS pushes** and own the multi-touch drip.
> Run **one** of the two paths per touch to avoid double-sends — see **§0 Coexistence** — or run
> both with GHL as the drip and FSOS native as the transactional confirmation only.
>
> **Nothing here overrides compliance.** Every SMS step is gated on `sms_consent`; every email
> step honors unsubscribe/DNC. Securities (`is_security`) workshops never enter these workflows
> — FSOS routes those registrants to the FFS-supervised path and never applies the `src-event`
> tag for them.

---

## 0. Coexistence with the FSOS native engine (read first)

FSOS pushes the binding **tags + `lead_source` + pipeline stage**; GHL workflows react to them.
To prevent a registrant getting the same touch twice:

| Touch | Recommended owner | Why |
|---|---|---|
| Registration **confirmation** + join link | **FSOS native** (`dispatch()`) | Transactional, tightly gated, immediate |
| 7d / 1d / 1h / starting reminders | **Pick one**: FSOS native **or** GHL drip | Both are built; enabling both double-sends |
| Post-event **segment nurture** drip | **GHL workflows** (this doc) | Multi-touch, day-2/day-4 cadence is GHL's strength |
| Lead-score math on segment tags | **GHL** (this doc, §4) | FSOS supplies the config-default delta; GHL applies it |

The FSOS native reminder templates ship **BLOCKED on approved copy** (placeholder, cannot
activate). Until that copy is approved, the **GHL reminder workflows are the only live path** —
so building them is what actually turns reminders on for launch.

---

## 1. Tag & field contract (what FSOS sets → what GHL triggers on)

FSOS writes these to the GHL contact (`src/lib/ghl.ts`, `src/lib/workshops/server.ts`,
`src/lib/workshops/comms-engine.ts`). Build every workflow trigger against **these exact values**.

| Signal | GHL key / tag | Set by FSOS when | Notes |
|---|---|---|---|
| Lead source | custom field `lead_source` = **`Event`** | registration → GHL push | live picklist option |
| Source tag | tag **`src-event`** | registration + convert + nurture | all workshop contacts |
| Workshop tag | tag **`wshop-<slug>`** | registration + convert + nurture | one per workshop topic (slug) |
| SMS consent | custom field `sms_consent` (+ `sms_consent_date`) | only if SMS box ticked | **gate every SMS step on this** |
| Email consent | custom field `email_consent` | only if email box ticked | |
| Contact timezone | custom field `contact_tz` | from session `timezone` | quiet-hours correctness |
| **Attended** segment | tag **`wshop-attended`** | post-event nurture, attended / left_early | |
| **No-show** segment | tag **`wshop-noshow`** | post-event nurture, no_show | largest segment |
| **Registered-no-show** | tag **`wshop-registered`** | post-event nurture, never checked in | recapture |
| Pipeline | **Prospect / Client** (`nuOBjRl27uhinHChdqfH`), stage **New Opportunity** (pos 1) | qualified attendee convert | Pipeline A |

**Quiet-hours / A2P:** SMS steps must respect 9am–8pm recipient-local and carry the approved
A2P/opt-out language. The registered SMS use case is **MIXED** (event reminders + educational
nurture). Do not add SMS copy that is not in the approved A2P campaign + disclosure config.

---

## 2. Pre-event reminder workflows (trigger: registration tags)

**Entry trigger (all):** Contact **Tag Added** = `wshop-<slug>` **AND** `lead_source = Event`.
**Global entry condition:** contact is **not** on DNC and the workshop is **not** securities
(FSOS never applies `src-event` to a securities-workshop registrant, so this is automatic).

Use GHL's **event date / appointment date math** (or a per-session date custom field) to schedule
each step relative to the session start `T`.

| WF | Name | Schedule | Channel | Consent gate | Steps | Ends / moves to |
|---|---|---|---|---|---|---|
| WSHOP-R0 | Workshop Confirmation | on entry (immediate) | Email (SMS optional) | email: `email_consent`; sms: `sms_consent` | Send confirmation w/ join link + Add-to-Calendar in paragraph 1 | stays in nurture; no stage move |
| WSHOP-R1 | Workshop 7-day Reminder | `T − 7d` | Email | `email_consent` | Skip if contact entered `< 7d` before `T`; else send value/agenda email | — |
| WSHOP-R2 | Workshop 1-day Reminder | `T − 24h` | Email **+** SMS | email: `email_consent`; **SMS step: `sms_consent`** | Email (prominent join link) → SMS logistics | — |
| WSHOP-R3 | Workshop 1-hour Reminder | `T − 1h` | SMS (+ email) | **`sms_consent`** for SMS | One CTA, one link SMS; optional email | quiet-hours: **do not send SMS outside 9–20 local** |
| WSHOP-R4 | Workshop Starting Now | `T` | SMS + Email | `sms_consent` / `email_consent` | Direct click-to-join | **never overrides quiet hours** — GHL "send window" 9–20 |

> **Build note.** In GHL, put each SMS step behind an **If/Else** on `sms_consent = true`, and set
> the workflow's **send window** to 9:00–20:00 in the contact timezone so a `T−1h`/`Starting Now`
> SMS that lands after 8pm is held, not sent (mirrors the FSOS gate's quiet-hours floor).

---

## 3. Post-event segmented nurture workflows (trigger: segment tags)

FSOS's nurture pass writes exactly one segment tag per registrant ~2–4h after the session
(config default `nurture_delay_minutes = 180`). Build one workflow per segment.

### WSHOP-N1 — Attended (engaged)
- **Trigger:** Tag Added = `wshop-attended`.
- **Entry condition:** `lead_source = Event`; not DNC.
- **Steps:** (day 0) thank-you email + recording/replay link + one resource → (day 2–3)
  value-add email → (day 4–5) **book-a-consult** email/SMS (SMS gated on `sms_consent`).
- **Routing:** contact already has a **Pipeline A** opportunity at **New Opportunity** (FSOS
  created it on the qualified convert). On **consult booked** (calendar/Calendly webhook) →
  move to **Appointment Scheduled** (pos 3).
- **Hot signal:** if contact replies / clicks consult → create an FSA **task** + notify.
- **Lead score:** `+15` on `wshop-attended` (see §4).

### WSHOP-N2 — Left early
- **Trigger:** Tag Added = `wshop-attended` **with** the FSOS `nurture_segment = left_early`
  (FSOS uses the same `wshop-attended` GHL tag for the attended family; branch on the
  registration's `chosen_delivery`/notes if you want a distinct "what you missed" copy, else
  fold into WSHOP-N1).
- **Steps:** "what you missed" + replay email → same consult CTA as N1 if engaged.
- **Lead score:** `+15` (treated as attended — they showed).

### WSHOP-N3 — No-show (largest segment)
- **Trigger:** Tag Added = `wshop-noshow`.
- **Entry condition:** `lead_source = Event`; not DNC.
- **Steps:** (day 0) "sorry we missed you" + **replay** link + "top 3 questions" email →
  (day 2) re-engage email → (day 3–4) consult invite. SMS step gated on `sms_consent`.
- **Routing:** **no opportunity yet** (FSOS tags + scores only). On **replay viewed** or
  consult click → create a **Pipeline A** opportunity at **New Opportunity** and re-enter the
  attended flow (WSHOP-N1).
- **Lead score:** `−5` on `wshop-noshow`, `+10` on replay-viewed (see §4).

### WSHOP-N4 — Registered, never checked in (recapture)
- **Trigger:** Tag Added = `wshop-registered`.
- **Entry condition:** `lead_source = Event`; not DNC.
- **Steps:** recapture email ("we saved your spot / here's the replay") → light educational
  follow-up **only if consent supports it**.
- **Routing:** recapture only; opportunity created on re-engagement, same as N3.
- **Lead score:** `−2` on `wshop-registered`.

### Opted-out
- No workflow. STOP/unsubscribe already lands the contact on DNC (FSOS `dnc_entries` +
  GHL opt-out); every workflow above must have the **not-DNC** entry condition so these are
  suppressed automatically.

---

## 4. Lead-score math (GHL applies the FSOS config-default delta)

FSOS ships the deltas as **assumption-badged config defaults** in `workshop_comms_config`
and records the applied delta on each registration (`lead_score_delta`, auditable). FSOS does
**not** clobber GHL's absolute `lead_score`; instead each segment tag drives a GHL
**"add to lead_score"** action with the matching delta:

| Segment tag | `lead_score` delta | FSOS config key |
|---|---|---|
| `wshop-attended` | **+15** | `score_attended` |
| (engaged: replied / consult-requested) | **+25** | `score_engaged` |
| `wshop-noshow` | **−5** | `score_no_show` |
| `wshop-registered` | **−2** | `score_registered_no_show` |
| replay-viewed | **+10** | `score_replay_viewed` |

Build a small "Lead Score" workflow (or add a math step to each N-workflow) that, on the
segment tag, adds the delta above to the `lead_score` custom field. Keep the numbers in sync
with `workshop_comms_config` (change them there first — they're editable/assumption-badged).

---

## 5. Verification checklist (do in GHL before flipping live)

- [ ] A test contact tagged `wshop-<slug>` + `lead_source=Event` enters WSHOP-R0…R4; each
      SMS step is skipped when `sms_consent` is false.
- [ ] A `T−1h` SMS scheduled for after 8pm local is **held** by the 9–20 send window.
- [ ] `wshop-attended` enters WSHOP-N1 and the existing Pipeline A opportunity is present.
- [ ] `wshop-noshow` enters WSHOP-N3 with **no** opportunity until replay/consult click.
- [ ] `wshop-registered` enters WSHOP-N4 (recapture only).
- [ ] A DNC/unsubscribed contact is suppressed from **every** workflow.
- [ ] Lead-score deltas match §4 / `workshop_comms_config`.
- [ ] **No securities workshop** contact ever carries `src-event` (spot-check a securities
      registration → confirm FSOS routed it to FFS, not GHL).
- [ ] SMS copy matches the **approved A2P campaign + disclosure config** (MIXED use case);
      no unapproved marketing/disclosure language.

---

## 6. Open items to confirm before launch (spec §10)

1. **10DLC/A2P:** confirm the SMS brand/campaign is registered for this MIXED traffic (reminders
   + educational nurture) before enabling any SMS step.
2. **Consult booking tool:** Calendly vs GHL calendar vs Google Calendar — set the "Appointment
   Scheduled" stage-move trigger to whichever fires the booking webhook.
3. **Approved copy:** every email/SMS body here is authored **in GHL from approved copy**; do not
   paste unapproved placeholder text. The FSOS-native templates remain blocked until the same
   copy is approved there.
