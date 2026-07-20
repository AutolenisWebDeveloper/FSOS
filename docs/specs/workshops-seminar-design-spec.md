# Workshop / Seminar Lead-Engine — Design Spec (READ-ONLY design pass)

> **Status: DESIGN PROPOSAL — nothing in this document has been implemented.** This is
> the deliverable of the read-only design + research pass requested 2026-07-20. No code,
> schema, or config was written or changed. Every intended change is *recorded* here as a
> plan; approval is required before any implementation begins.
>
> Owner: Markist Athelus (FSA). Compliance sign-off owner referenced throughout: **Ryan
> Anderson (FFS compliance)**. Prepared against `CLAUDE.md` (§1–§10), the `fsos-dev`
> conventions, `DESIGN.md`, and `PRODUCT.md`, all treated as authoritative.

---

## 0. Executive summary — the one thing to know

**A workshop subsystem already exists in FSOS and is spine-linked.** This is not a
greenfield build. There are working tables (`workshops`, `workshop_registrations`,
extended in `018_forms_workshops.sql`), a public registration surface (`/events`,
`/events/[id]`, `WorkshopRegisterForm`), a staff surface (`/app/workshops/*`,
`WorkshopForm`, `WorkshopStatusControl`, `WorkshopRegistrations`), public + internal API
routes, Zod schemas, RLS policies, audit wiring, and consent capture. The design below
**extends that scaffold** — it does not duplicate the design system, the CRM/spine model,
the comms dispatcher, or the GHL workflow program.

The scaffold has three structural gaps that make it a *seminar page*, not a
*compliance-gated lead engine*, and closing them is the whole project:

1. **No compliance gate on publish.** `WorkshopStatusControl` flips `draft → published`
   with a bare status PATCH and no `compliance_approval_ref`. For a dually-licensed
   (insurance + securities) agent this is the single most important control to add.
2. **No delivery-mode model.** `location` is one free-text field. In-person / virtual /
   hybrid, venue logistics, and Zoom join-link provisioning do not exist.
3. **No engine.** No reminder cadence, no segmented post-event nurture into the consult
   pipeline, no attendance capture beyond a boolean, no materials/versioning, no
   feedback, no replay, and consent is captured as a staging array but never turned into
   durable TCPA/A2P consent evidence.

Two research findings shape every priority call below:
- **Virtual no-show is the majority case** (~52–65%). The reminder engine, the no-show
  nurture flow, and a finite-window replay are therefore the *core value*, not polish.
- **TX/TDI seminar-labeling rule** constrains the literal wording of any "educational
  workshop" invitation in Texas — a design-level constraint on copy, not just a backend
  flag.

---

## 1. Inventory of reusable FSOS / GHL assets → how the workshop system reuses them

Every row below is an **existing** asset. The workshop engine plugs into it; it does not
re-create it.

| Concern | Existing asset (reuse — do NOT rebuild) | How the workshop engine uses it |
|---|---|---|
| **Event + registration storage** | `workshops`, `workshop_registrations` (`001` + extended `018_forms_workshops.sql`). Registrations already carry `referral_id`, `household_id`, `name/email/phone`, `consent_channels text[]`, `status`. | Add columns for delivery mode, sessions, attendance, join tokens, feedback, and a compliance-approval FK — additively (§6). |
| **Consent capture** | `consents(member_id, channel, status, source, disclosure, captured_at)` (`009`); staging arrays `workshop_registrations.consent_channels` / `form_responses.consent_channels`; materialization loop in `POST /api/referrals/[id]/convert` (`route.ts:145-158`). DNC: `dnc_entries`. | Capture per-channel consent + **evidence** at registration; materialize into `consents` on convert-to-referral, copying the existing upsert loop. New `workshop_consent_events` table holds the TCPA/A2P evidence the staging array can't (§4, §6). |
| **SMS / email dispatch (§7)** | `dispatch()` → `evaluateGate()` (`src/lib/comms/dispatcher.ts`, `gate.ts`) → `sendSms`/`sendEmail` (`src/lib/messaging.ts`, Twilio + Resend). 8-step gate; no force-send path; blocks escalate. | Every FSOS-originated reminder/nurture send goes through `dispatch()`. Never call `sendSms`/`sendEmail` directly. GHL-originated nurture is a parallel channel (§7). |
| **Compliance guardrail (§2.2)** | `validateAIClientMessage()`, `containsRecommendationLanguage()`, firewall `assertNotSecuritiesSystemOfRecord()` (`src/lib/compliance/*`). | The publish gate calls the firewall + guardrail before flipping status. Any AI-drafted invite/reminder body is validated before dispatch. |
| **Publish state machine** | `workshops.status` machine + `WorkshopStatusControl.tsx` + `PATCH /api/workshops/[id]`; public render gated on `status='published'` (`events/[id]/page.tsx:23`). | Extend the machine to `draft → pending_review → compliance_approved → published → completed` (+ `cancelled`), and hard-block the `→ published` transition unless `compliance_approval_ref` is set (§8). |
| **RLS** | `has_role()`, `is_super()`, `current_user_*()` SECURITY DEFINER helpers (`010_rls_guardrails.sql`); existing `workshops_staff_read` / `workshop_regs_staff_read` policies (`018:126-134`); `households` policy shape (`010:118-124`). | New tables copy these exact policy shapes; default-deny + staff read + service-role writes after route rbac (§6). |
| **Public UI shell** | `PublicPage`, `PublicCard`, `PublicBrandLockup`, `PublicAlert` (`src/components/public/PublicShell.tsx`); `WorkshopRegisterForm.tsx`; `forms/Field.tsx`; marketing primitives `Hero`, `HowItWorks`, `CalendlyEmbed` (`src/components/public/marketing/*`). | Landing/hub/registration/confirmation/post-event pages compose these primitives — same Farmers-navy-lockup-on-light-canvas identity (§5). |
| **Staff UI shell** | Archetype shells `src/components/archetypes/*` (`ListShell`, `DetailShell`, `DashboardShell`, `StatTile`, `FormShell`, `ReportShell`, `EmptyState`, `ForbiddenState`, skeletons); `ui/*` shadcn primitives; `AssumptionBadge` (gold) `states.tsx:113`; securities marker `ui/securities.tsx` (purple). | Ops dashboard, roster, check-in, reporting compose these. Assumption badge on any config-default figure; purple marker if a workshop is `is_security`-flagged (§5, §8). |
| **API conventions** | `dynamic='force-dynamic'` + `runtime='nodejs'` + `getDb()` + Zod (`@/lib/validation/schemas`) + `readJson`/`configErrorResponse` + `writeAudit` + `requireApiRole`/`requirePermission`. Templates: `/api/workshops/route.ts` (internal), `/api/public/workshops/register/route.ts` (public: honeypot + `rateLimit` + `clientIp`). | Every new route follows these verbatim. Public intake keeps honeypot + rate-limit + no-auth service-role pattern. |
| **GHL sync + fields** | `src/lib/ghl.ts` — Pipeline A `prospect_client` (`nuOBjRl27uhinHChdqfH`), `upsertContactWithRetry`, `createOpportunity`, `moveOpportunityStage`, `addContactTags`; `GHL_CUSTOM_FIELDS` incl. `sms_consent`, `sms_consent_date`, `email_consent`, `lead_source` (live picklist has an **`Event`** option), `contact_tz`, `lead_score`; webhook `POST /api/webhooks/ghl` (HMAC). The "45 workflows" (WF-0…WF-43) live in GHL and are confirmed manually (`docs/ghl_integration.md §3`). | Registration pushes a contact with `lead_source="Event"` + `src-event` / `wshop-<slug>` tags; enrollment into GHL reminder + post-event workflows is triggered by tag; qualified attendees route into Pipeline A (§3, §7). |
| **Consult pipeline (routing target)** | The `reviews` + `opportunities` + `appointments` spine — NOT a bespoke table. `reviews.type ∈ (policy,coverage,term_conversion,retirement,annual)`; WF-2 booking flow; `appointments.external_ref` = Google Calendar id; Calendly webhook `/api/webhooks/calendly` (sets `consent_email`, deliberately **not** SMS). | Post-event "book a consultation" converts registration → `referrals` (existing 24h-SLA convert) → `opportunities` (stage `prospect`) → schedule `reviews` (type `retirement`/`annual`) → `appointments`. Calendly/GHL calendar provisions the consult (§3, §7, §10). |
| **Audit (§5)** | append-only `audit_log(actor, action, entity, entity_id, diff, at)`; `writeAudit()`. | Every workshop mutation, consent capture, approval, publish, send, check-in writes audit rows — also the 17a-4/4511 evidence trail (§8). |

**Deprecation note:** two public registration routes exist. Build on the spine one
(`POST /api/public/workshops/register`, writes `workshop_registrations` + `consent_channels`,
honeypot + rate-limit). Treat the legacy customer-linked `POST /api/workshops/register`
(creates `customers`, sends its own Resend confirmation) as **deprecated** — do not extend it.

---

## 2. Superpowers research findings — funnel architecture & benchmarks (cited)

*Industry aggregates from vendor reports. Treat as planning ranges; instrument the real
funnel and recalibrate. Full source list in Appendix A.*

### 2.1 The five measured funnel stages
Model each as a timestamped state transition so drop-off is attributable:
1. Impression → **Registration** · 2. Registration → **Attendance** · 3. Attendance →
**Engagement** (poll/Q&A/download — strongest conversion predictor) · 4. Attendance →
**Consult booked** (the money stage) · 5. Consult → Case (spine; attribution must carry
through immutably).

### 2.2 Benchmark table (planning ranges — verify against own data)

| Metric | In-person | Virtual | Note |
|---|---|---|---|
| Registration → live attendance | ~60–70% | ~35–48% (median ~42%) | virtual show-up ≈ minority |
| No-show rate | ~30–40% | ~52–65% | inverse |
| Attendee → consult booked | 3–8% | 5–20% (15–25% well-run) | the ROI stage |
| Attendee → lead (workshop format) | 24.6% (workshop) vs 11.3% (demo) | — | interactive deliverable outconverts slides |
| Replay lift | n/a | ~2.4× unique vs live; ~89% of registrants reached within 72h when replay promoted <2h post-event; most replay watch-time in first 14 days | replay is a second funnel |

**Design implication:** the reminder engine, no-show nurture, and finite-window replay
are the core of the system's value, not add-ons — because the majority of virtual
registrants never show live and are recovered through exactly those channels.

### 2.3 Reminder cadence (email + SMS; each gated independently on consent)
Sequences move attendance from ~30% → ~50%. Consensus cadence:

| Timing | Channel | Purpose |
|---|---|---|
| On registration | Email (SMS optional) | Confirmation — join link + Add-to-Calendar in paragraph 1 (highest open) |
| ~7 days before | Email | Value/agenda (skip if booked <7d out) |
| 1 day (24h) before | Email + SMS | Logistics, prominent join link |
| ~3 hours before | Email or SMS | Frequently highest-yield, under-used |
| 1 hour before | SMS (email too) | One CTA, one link, phone-length |
| "Starting now" | SMS + email | Direct click-to-join |

Join link in paragraph 1 of every reminder. **The event start time never overrides
quiet-hours law** — a "starting now" SMS at 8:05pm local is still blocked by the gate.

### 2.4 Segmented post-event nurture (trigger ~2–4h post-event)
- **Attended (engaged):** thank-you + recording + resource + one insight → day 2–3
  value-add → day 4–5 specific consult offer. Route hot signals (asked a question,
  requested consult) to the FSA for personal outreach.
- **Attended, left early:** warm; "what you missed" + replay.
- **Registered, no-show (largest segment):** "sorry we missed you" catch-up + "top 3
  questions" + replay. Replay is the primary recovery lever.
- **Opted-out / not interested:** suppress from consult-push; low-frequency educational
  only if consent supports it.

### 2.5 Data-architecture pattern (informs §6)
```
workshop (topic/series, format, compliance-approval refs)
 └─ session (one dated occurrence; format=in_person|virtual|hybrid; capacity_in_person, capacity_virtual; times UTC)
      ├─ registration (person, lead_source, join_method, unique_join_token, ics_uid)
      │    └─ attendance (status registered|attended|no_show|left_early; join/leave; capture_method checkin|webhook)
      └─ feedback (survey, NPS, consult_requested)
```
Key rules: **store times UTC, render local** (attendance + quiet-hours correctness);
**attendance capture is a typed field** (in-person check-in scan vs Zoom
`participant_joined/left` webhook — which can fire multiple times and must be correlated
by `registrant_id`/join-token, never name matching); **lead-source captured at
registration and carried immutably** to the consult.

### 2.6 Hybrid + provisioning
Single registration surface that branches to an in-person path (physical seat, capacity,
QR/badge for check-in) or virtual path (unique Zoom `join_url` + registrant token).
Support channel switch without re-registration. Serve **both** a hosted `.ics` (stable
`ics_uid`, UTC, `SEQUENCE`/`METHOD` for updates/cancels) **and** per-client Add-to-Calendar
links; put the join link inside the calendar event body. Consult booking (Calendly/GHL
calendar) is pre-filled with attendee identity + event attribution so the booked consult
inherits `lead_source`.

---

## 3. Impeccable UX design

**Register split.** The public surface (hub, landing, registration, confirmation,
post-event) is **brand register** — but identity-preservation wins: it extends the
existing FSOS public shell (`PublicPage` + Farmers-navy lockup on cool light canvas,
DM Sans/Mono, `--primary` Farmers blue). No new aesthetic lane. The staff surface (ops
dashboard, roster, check-in, reporting, approval) is **product register** — dense,
archetype-composed, `PortalShell`.

### 3.1 Information architecture / sitemap

**Public (unauthenticated, on the allowlist):**
```
/workshops                     Hub — upcoming workshops, filter by topic/format/date        (replaces /events index; keep /events → 301)
/workshops/[slug]              Topic landing page — hero, agenda, host, disclosures, register CTA
/workshops/[slug]/register     Registration flow (or modal on landing for short forms)
/workshops/[slug]/confirmed    Confirmation — details, join method, .ics + Add-to-Calendar, what's next
/workshops/[slug]/replay       Post-event page — recording (finite window), feedback survey, book-a-consult CTA
/r/w/[token]                   Personalized short link (reminder deep-link → confirmed/replay; carries registration token)
```
Slug lives on the workshop (topic/series). A workshop may have one or many dated
**sessions**; the landing page lists them; a registration is to a specific session.
Legacy `/events/[id]` stays working (301 → `/workshops/[slug]?session=<id>`), so live
links and the existing register route are not broken.

**Staff (FSA / admin / compliance portals):**
```
/app/workshops                 Ops dashboard — funnel KPIs, upcoming sessions, needs-action queue   (extends existing list page)
/app/workshops/new             Create (extends existing WorkshopForm with delivery-mode + sessions)
/app/workshops/[id]            Detail — overview, sessions, roster, materials, attendance, reporting, comms, compliance tabs
/app/workshops/[id]/check-in   Kiosk / mobile check-in (staff-authed, tablet-first)
/compliance/workshops          Compliance queue — pending_review approvals, 2210 recordkeeping, filing flags
```

### 3.2 Per-page wireframe descriptions (public)

**`/workshops` — Hub.** `PublicPage` (top-aligned). H1 "Educational workshops" + one-line
subhead (educational-only framing). Filter row (topic chips: Retirement / Life / Business
/ General — reuse `TOPIC_ICON` from `EventsIndex`; format toggle In-person/Virtual/Hybrid;
month). Card list (reuse the existing `EventsIndex` link-card: topic icon chip, title,
date, **format badge**, location/"Online", seats-remaining or "Waitlist"). Empty state:
existing "No upcoming workshops — check back soon." Each card → `/workshops/[slug]`.
States: skeleton (existing `Skeleton` rows), error (`PublicAlert`), empty. Mobile: single
column, filters collapse into a sheet.

**`/workshops/[slug]` — Topic landing.** Brand-register but on-identity. Fold 1: hero band
(`shell-gradient` lockup header from `PublicCard`, or a Hero variant) — title, one-sentence
promise, session date/time (local, with tz label), **format badge**, primary "Reserve your
seat" CTA, seats-remaining microcopy. Fold 2: "What you'll learn" (3–5 bullets, the
interactive-deliverable hook from research 2.1) + agenda + host bio (Markist, credentials,
NOT a product pitch — TDI/2210 framing §8). Fold 3: logistics (venue map or "Join online"
+ what-to-bring), session picker if multiple sessions. Footer: **required disclosures block**
(educational-only; "insurance sales presentation" equal-prominence line where TDI applies —
§8 control 4; approval-status-driven, never fabricated). Sticky mobile CTA bar. Motion:
one restrained fold-1 reveal (respect `prefers-reduced-motion`). A11y: single H1, agenda as
real list, CTA is a `<button>`/`<a>` with visible focus ring (`--ring`).

**Registration flow.** Single card (`WorkshopRegisterForm` extended), progressive not
multi-step for the common case. Fields: full name (required), email (required), phone
(optional — required only if SMS consent is checked), session select (if >1), in-person vs
virtual choice (hybrid only), + honeypot (existing `company`). **Consent block — the
compliance centerpiece:**
- A bordered `<fieldset>` "Contact permission" (existing pattern, hardened).
- **Email consent** and **SMS consent are separate, individually unchecked, optional
  checkboxes** — never bundled, never pre-checked, never a condition of registering
  (TCPA §8 control 6).
- SMS checkbox label carries the full A2P disclosure: purpose (event reminders),
  frequency ("msg frequency varies"), "Msg & data rates may apply", "Reply STOP to opt
  out, HELP for help", and a link to `/sms-terms` (route exists) + privacy.
- Required disclosures rendered inline above submit (educational-only; recording-consent
  line for virtual/hybrid — §8 control 9).
- Submit is enabled without any consent box checked (registration ≠ marketing consent).
States: idle / submitting (button `loading`) / success (existing green `status-won`
confirmation, but now → redirect to `/workshops/[slug]/confirmed`) / full ("waitlist" CTA)
/ field errors (`Field` error slot, `aria-invalid`) / rate-limited. A11y: every input
labelled, checkboxes are real checkboxes, error summary `role="alert"`.

**`/confirmed` — Confirmation.** Success hero ("You're registered"). **Join method block**
that branches on delivery mode: in-person → address + map link + "add to calendar" + what
to bring; virtual → "Your unique join link" (never shared) + "add to calendar"; hybrid →
the option they chose, with a "switch to online/in-person" link. **Add-to-Calendar**: both
a hosted `.ics` download and Google/Outlook/Apple buttons; join link embedded in the event
body. "What happens next" (reminders they'll get, on which channels they consented to).
Secondary CTA: "Add a friend" / share. A11y + mobile: buttons ≥44px targets, single column
at 360px.

**`/replay` — Post-event.** Gated to `completed` sessions. Recording embed (finite window
banner: "Available through <date>"); if window closed → "Recording no longer available" +
"Book a 1:1 to get your questions answered". **Feedback survey** (short: rating, "what was
most useful", "would you like a personal review?" → sets `consult_requested`). **Book-a-
consultation CTA** → Calendly/GHL calendar pre-filled with attendee + attribution.
Educational-only framing throughout. States: not-yet-available, available, window-closed,
already-submitted-feedback.

### 3.3 Per-page wireframe descriptions (staff, product register)

**`/app/workshops` — Ops dashboard.** `DashboardShell`. Top: `StatTile` row —
Registrations, Attendance rate, No-show rate, Consult-conversion, all with the source
drill-through the tile already supports; **any benchmark-derived target renders with the
gold `AssumptionBadge`** (config default — verify). "Needs action" queue (sessions in
`pending_review`, sessions completed with attendance not reconciled, hot post-event
signals). Upcoming-sessions table (`ListShell` + `Table`: title, date, format badge,
status chip, registered/capacity, approval state). Filter/toolbar. Empty/skeleton/error
states from `archetypes/states`.

**`/app/workshops/[id]` — Detail (`DetailShell`, navy header band + status chips + tabs):**
- **Overview:** title/topic/format/host, status chip, compliance banner (approved-by /
  ref / filing flag, or a red "Not approved — cannot publish" bar), assumption badges on
  any config figure. Purple securities marker if `is_security`.
- **Sessions:** each dated occurrence, capacities (in-person/virtual), Zoom link status.
- **Roster:** `WorkshopRegistrations` extended — attendee, channel consents (email/SMS
  chips), attendance status, convert-to-referral action, hot-signal flag.
- **Materials:** versioned invite / landing / slides / recording, each with approval
  status + 2210 classification + filing decision (§8).
- **Attendance:** reconcile check-in + webhook data; mark attended/no-show/left-early.
- **Comms:** reminder schedule (which sends fired / are queued / were gated-and-why),
  nurture enrollment state.
- **Reporting:** the funnel for this workshop (§5 metrics).
- **Compliance:** approval history, recordkeeping links, retention markers.

**`/app/workshops/[id]/check-in` — Kiosk/mobile.** Tablet-first. Big search-or-scan;
attendee list with one-tap "Check in"; walk-in "Add attendee" (captures consent same as
public); live count vs capacity. Offline-tolerant note (queue writes). Large touch targets,
high contrast, minimal chrome.

**`/compliance/workshops` — Compliance queue.** `ListShell`. Sessions in `pending_review`
with the asset bundle (invite, landing, slides); approve/reject with `compliance_approval_ref`
capture (approver name/CRD/date), 2210 classification field, filing-decision field. Reject
returns to `draft` with a reason. This is where Ryan Anderson works.

### 3.4 States, accessibility, responsiveness (applies to all pages — Definition of Done §8)
- **States:** every page ships empty / loading (skeleton, never bare spinner) / error
  (isolated, retryable) / success; roster + reporting ship archived/deleted behavior.
- **A11y — WCAG 2.2 AA:** body ≥4.5:1 (public brand copy must not drift to muted gray on
  tint — Impeccable color rule), large text ≥3:1; all inputs labelled; consent checkboxes
  real and keyboard-operable; visible focus rings (`--ring`); `role="alert"` on errors;
  target size ≥24px (2.2) — use ≥44px on public CTAs and check-in; respect
  `prefers-reduced-motion`; forms have an error summary; `.ics`/calendar buttons have
  discernible text.
- **Responsive to 360px:** public pages single-column; landing hero clamps and **must not
  overflow** at 360/768 (test the real title copy); staff tables → horizontal scroll
  inside an `overflow-x:auto` container (page body never scrolls horizontally); check-in is
  mobile-first; sticky mobile CTA on landing.

---

## 4. Consent & consent-evidence design (TCPA / A2P — architectural)

The existing `consent_channels text[]` staging array records *which* channels a registrant
ticked, but not the **evidence** a TCPA/A2P express-written-consent record needs. Design:

- **At registration**, in addition to writing `consent_channels`, write a
  `workshop_consent_events` row per channel consented (§6) capturing: channel, the **exact
  disclosure text + version** shown, IP address, user-agent, timestamp (UTC), the workshop/
  session/registration ids, and the registration source. This is the durable evidence
  record (audit_log alone is not structured enough for retrieval on demand).
- **`consent_channels`** remains the staging array on the registration for the convert flow.
- **On convert-to-referral → household member**, materialize into spine `consents`
  (`member_id, channel, status='granted', source='workshop', disclosure=<version>`) using
  the existing upsert loop. The `workshop_consent_events` row is the provenance that
  `consents.source`/`disclosure` point back to.
- **Revocation:** STOP/opt-out flows already land via the comms gate + `dnc_entries`;
  a revoke writes a `status='revoked'` consent event, and the dispatcher's DNC + consent
  checks block future sends. No workshop-specific opt-out path — reuse the platform's.
- **Registration is never conditioned on consent.** Email and SMS consent are independent,
  optional, unchecked. Phone becomes required only when SMS is ticked.

---

## 5. Attendance + reporting design

**Check-in (in-person):** staff `/app/workshops/[id]/check-in` — search/scan a
registration token (QR on the confirmation/`.ics`), one-tap check in, walk-in add. Writes
an attendance row `capture_method='checkin'`, `status='attended'`, `checked_in_at`.

**Attendance (virtual):** Zoom `webinar.participant_joined` / `_left` (or
`meeting.participant_*`) via a new webhook `POST /api/webhooks/zoom` (HMAC-verified like
the GHL/Calendly webhooks). Correlate by the stored **registrant token**, not name.
Compute duration; derive `left_early` against a threshold (config default — verify badge).
Handle duplicate/reconnect events idempotently. `capture_method='webhook'`.

**Hybrid:** one attendance table, `capture_method` distinguishes source; both feed the same
reporting.

**Metrics that matter (dashboard + per-workshop report — reuse `ReportShell`/`StatTile`):**
registrations, **attendance rate** (attended/registered, split in-person/virtual),
**no-show rate**, engagement (feedback submitted, questions asked, resources downloaded),
**consult-conversion** (registrations → consult booked → showed), **lead-source
attribution** (by referring agency slug / campaign / UTM), replay reach, and
cost-per-lead if venue/spend is entered (assumption-flagged). Every planning-range target
(from §2.2) shows the gold assumption badge; nothing is presented as a Farmers-published
figure.

---

## 6. Data model — commented SQL sketch (PROPOSAL — not applied)

> Next migration number would be **`038_workshops_seminar_engine.sql`** (highest existing
> is `037`). Additive only — extends live tables, drops nothing, mirrors existing RLS
> helpers and the `018` policy shapes. **This is a sketch for review, not an applied
> migration.** DDL is illustrative; column names/types to be finalized at build time.

```sql
-- 038_workshops_seminar_engine.sql  (PROPOSAL — DO NOT APPLY WITHOUT APPROVAL)
-- Extends the existing workshops/workshop_registrations scaffold (001 + 018) into a
-- compliance-gated lead engine. Additive; legacy columns retained. Guardrails: no
-- securities fields collected here (§2.1); consent evidence captured (§7 comms / TCPA);
-- publish hard-gated on a compliance approval ref; every mutation audited in the route.

-- 1. workshops: delivery mode, slug, host, and the compliance approval pointer -------
alter table workshops add column if not exists slug text unique;                 -- /workshops/[slug]
alter table workshops add column if not exists delivery_mode text not null default 'in_person'
  check (delivery_mode in ('in_person','virtual','hybrid'));
alter table workshops add column if not exists host_name text;                   -- editable config, not a Farmers fact
alter table workshops add column if not exists is_security boolean not null default false; -- firewall flag (excludes from auto-comms)
-- Publish gate: status extended; publishing REQUIRES compliance_approval_ref (enforced in route + trigger).
alter table workshops add column if not exists compliance_approval_ref uuid;     -- FK -> workshop_approvals(id)
-- status now: draft | pending_review | compliance_approved | published | completed | cancelled
--   (existing rows default 'draft'; keep the existing check-free text col or widen the check additively)

-- 2. workshop_sessions: one dated occurrence of a workshop -----------------------------
create table if not exists workshop_sessions (
  id                 uuid primary key default gen_random_uuid(),
  workshop_id        uuid not null references workshops(workshop_id) on delete cascade,
  starts_at          timestamptz not null,           -- store UTC, render recipient-local
  ends_at            timestamptz,
  timezone           text not null default 'America/Chicago',
  delivery_mode      text not null default 'in_person'
                       check (delivery_mode in ('in_person','virtual','hybrid')),
  venue_name         text,
  venue_address      text,
  capacity_in_person integer,
  capacity_virtual   integer,
  zoom_meeting_id    text,                            -- provisioned link source (no securities data)
  ics_uid            text unique,                     -- stable calendar id for updates/cancels
  recording_url      text,                            -- replay (finite window)
  recording_expires_at timestamptz,
  status             text not null default 'scheduled'
                       check (status in ('scheduled','live','completed','cancelled')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_wsessions_workshop on workshop_sessions(workshop_id);
create index if not exists idx_wsessions_starts on workshop_sessions(starts_at);

-- 3. workshop_registrations: session link, delivery choice, join token, attribution ---
alter table workshop_registrations add column if not exists session_id uuid references workshop_sessions(id) on delete cascade;
alter table workshop_registrations add column if not exists chosen_delivery text
  check (chosen_delivery in ('in_person','virtual'));            -- hybrid: which audience
alter table workshop_registrations add column if not exists join_token text unique;   -- unique per-registrant (Zoom correlation + QR check-in)
alter table workshop_registrations add column if not exists join_url text;            -- provisioned virtual link (per registrant)
alter table workshop_registrations add column if not exists lead_source text;         -- referring agency slug / campaign / utm (immutable)
alter table workshop_registrations add column if not exists ghl_contact_id text;      -- attribution carry-through

-- 4. workshop_attendance: typed capture, in-person + virtual into one table -----------
create table if not exists workshop_attendance (
  id             uuid primary key default gen_random_uuid(),
  registration_id uuid not null references workshop_registrations(reg_id) on delete cascade,
  session_id     uuid not null references workshop_sessions(id) on delete cascade,
  status         text not null default 'registered'
                   check (status in ('registered','attended','no_show','left_early')),
  capture_method text check (capture_method in ('checkin','webhook','manual')),
  checked_in_at  timestamptz,
  join_time      timestamptz,
  leave_time     timestamptz,
  duration_min   integer,
  created_at     timestamptz not null default now(),
  unique (registration_id, session_id)
);

-- 5. workshop_consent_events: durable TCPA/A2P evidence (what the staging array can't hold)
create table if not exists workshop_consent_events (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references workshop_registrations(reg_id) on delete cascade,
  channel         text not null check (channel in ('sms','email')),
  action          text not null default 'granted' check (action in ('granted','revoked')),
  disclosure_text text not null,       -- exact copy shown
  disclosure_version text not null,    -- version tag for retrieval
  ip_address      text,
  user_agent      text,
  captured_at     timestamptz not null default now()
);
create index if not exists idx_wconsent_reg on workshop_consent_events(registration_id);

-- 6. workshop_materials: versioned collateral + 2210 recordkeeping (§8) ---------------
create table if not exists workshop_materials (
  id             uuid primary key default gen_random_uuid(),
  workshop_id    uuid not null references workshops(workshop_id) on delete cascade,
  kind           text not null check (kind in ('invitation','landing_page','slides','handout','recording','email','sms')),
  version        integer not null default 1,
  storage_ref    text,                 -- document/storage pointer (no securities data)
  finra_2210_class text,               -- retail | institutional | correspondence  (REQUIRES-APPROVAL to set)
  filing_decision text,                -- pre_use | within_10_days | exempt | n_a   (REQUIRES-APPROVAL)
  filing_ref     text,                 -- FINRA Ad Reg reference if filed
  created_at     timestamptz not null default now(),
  unique (workshop_id, kind, version)
);

-- 7. workshop_approvals: the HARD GATE record (principal pre-approval, §8) ------------
create table if not exists workshop_approvals (
  id              uuid primary key default gen_random_uuid(),
  workshop_id     uuid not null references workshops(workshop_id) on delete cascade,
  approver_name   text not null,       -- e.g. Ryan Anderson (FFS)
  approver_crd    text,                -- registered principal CRD
  decision        text not null check (decision in ('approved','rejected')),
  notes           text,
  material_versions jsonb,             -- snapshot of the exact asset versions approved
  decided_at      timestamptz not null default now()
);
-- workshops.compliance_approval_ref -> workshop_approvals(id) where decision='approved'.

-- 8. workshop_feedback: post-event survey + consult intent ----------------------------
create table if not exists workshop_feedback (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references workshop_registrations(reg_id) on delete cascade,
  rating          integer check (rating between 1 and 5),
  most_useful     text,
  consult_requested boolean not null default false,
  submitted_at    timestamptz not null default now()
);

-- 9. RLS — copy the 018/010 shapes exactly (default-deny; staff read; service-role writes)
alter table workshop_sessions          enable row level security;
alter table workshop_attendance        enable row level security;
alter table workshop_consent_events    enable row level security;
alter table workshop_materials         enable row level security;
alter table workshop_approvals         enable row level security;
alter table workshop_feedback          enable row level security;

create policy wsessions_staff_read on workshop_sessions for select using (
  is_super() or has_role('fsa') or has_role('licensed_staff') or has_role('admin') or has_role('ops')
);
create policy wapprovals_read on workshop_approvals for select using (
  is_super() or has_role('compliance') or has_role('supervisor') or has_role('fsa') or has_role('licensed_staff')
);
-- ...same shape for attendance/consent_events/materials/feedback; consent_events read
--    restricted to compliance/fsa/super (evidence). Public writes only via service-role
--    routes after honeypot + rate-limit (no anon RLS grant).

-- 10. Publish hard-gate (belt-and-suspenders to the route check):
--   a BEFORE UPDATE trigger on workshops that raises if NEW.status='published'
--   and NEW.compliance_approval_ref is null. (Route enforces first; trigger is the floor.)
```

**Firewall note (§2.1):** none of these tables store securities account numbers, order
details, suitability determinations, or client-facing securities communications. A
securities-touching workshop is *tracked* (`is_security=true`) and thereby **excluded from
the automated comms engine**; individualized securities discussion routes to the
FFS-supervised channel.

### 6.1 GHL field-key ↔ Supabase-column binding map

| GHL custom field / entity | GHL key | Supabase source | Direction | Note |
|---|---|---|---|---|
| Lead source | `lead_source` | `workshop_registrations.lead_source` → contact | FSOS → GHL | Set value **`"Event"`** (live picklist option); plus tags `src-event`, `wshop-<slug>` |
| SMS consent | `sms_consent` | derived from `consent_channels`/`workshop_consent_events` | FSOS → GHL | only if SMS box ticked |
| SMS consent date | `sms_consent_date` | `workshop_consent_events.captured_at` | FSOS → GHL | evidence timestamp |
| Email consent | `email_consent` | `consent_channels` | FSOS → GHL | |
| Contact timezone | `contact_tz` | session `timezone` / contact | FSOS → GHL | quiet-hours correctness |
| Lead score | `lead_score` | scoring engine (post-event bump) | FSOS → GHL | attended/no-show adjusts score (§7) |
| Contact | contact upsert | `upsertContactWithRetry` | FSOS → GHL | Pipeline A `prospect_client` |
| Opportunity | `createOpportunity('prospect_client', 1)` | on qualified attendee | FSOS → GHL | New Opportunity stage |
| Appointment booked | webhook | `appointments` / `/api/webhooks/ghl` | GHL → FSOS | consult booking back-flow |

The "45 workflows" (WF-0…WF-43) are triggered by tag/pipeline in GHL and are **confirmed
manually in the GHL UI** (`docs/ghl_integration.md §3`) — the binding contract is the tag +
`lead_source` + pipeline-stage, not an API-enumerable workflow list.

---

## 7. Nurture flow specs → GHL workflows (reuse vs net-new)

Two dispatch paths, deliberately: **FSOS-native** transactional sends go through
`dispatch()`/`gate.ts` (confirmation, join links — tightly gated); **GHL workflows** own
the multi-touch reminder + nurture cadence (triggered by tag). Each send is gated on the
matching consent channel independently.

### 7.1 Pre-event (trigger: registration → tag `wshop-<slug>` + `src-event`)

| Send | Timing | Channel | Path | Reuse vs new |
|---|---|---|---|---|
| Confirmation + join link + .ics | on register | Email (SMS optional) | **FSOS `dispatch()`** | **New** transactional template; reuses dispatcher/Resend |
| 7-day reminder | −7d | Email | GHL workflow | **New** WF (or clone nearest reminder WF); reuses GHL email + Resend infra |
| 1-day reminder | −24h | Email + SMS | GHL workflow | **New**; SMS step gated on `sms_consent` |
| 3-hour reminder | −3h | Email or SMS | GHL workflow | **New** |
| 1-hour reminder | −1h | SMS (+email) | GHL workflow | **New**; quiet-hours enforced |
| Starting now | T-0 | SMS + email | GHL workflow | **New**; **never overrides quiet hours** |

### 7.2 Post-event (trigger: attendance reconciliation writes status → tag)

| Segment | Tag | Flow | Routing | Reuse vs new |
|---|---|---|---|---|
| Attended (engaged) | `wshop-attended` | thank-you + recording + resource → day 2–3 value → day 4–5 consult offer | hot signal (`consult_requested`) → FSA task + Pipeline A opportunity | **New** WF; **reuses** Pipeline A `prospect_client` + consult booking |
| Left early | `wshop-left-early` | "what you missed" + replay | as above if engaged | **New** WF |
| No-show | `wshop-noshow` | "sorry we missed you" + top-3 Qs + replay | replay view → re-enter attended flow | **New** WF (largest segment — highest ROI) |
| Opted-out | `wshop-optout` | suppress consult-push; low-freq educational only if consent | none | **Reuse** existing suppression/DNC |

**Lead-score adjustment:** attended +X, engaged +Y, no-show −Z, replay-viewed +W (all
config-default, assumption-badged), pushed to GHL `lead_score`. **Consult routing** reuses
the existing spine path: registration → `referrals` (24h SLA convert exists) →
`opportunities` stage `prospect` → schedule `reviews` (type `retirement`/`annual`) →
`appointments` (Google Calendar `external_ref`) / Calendly. No net-new consult pipeline.

---

## 8. Compliance layer — enforced controls + REQUIRES-APPROVAL register

Compliance is architectural here, not documentation. Enforced controls:

1. **Publish hard-gate.** `workshops.status → 'published'` is blocked unless
   `compliance_approval_ref` points to an `approved` `workshop_approvals` row. Enforced in
   `PATCH /api/workshops/[id]` (route rbac + check) **and** a BEFORE-UPDATE DB trigger
   (floor). `WorkshopStatusControl` gains a `pending_review` step; the Publish button is
   disabled and reason-labelled until approved.
2. **Principal pre-approval + 2210 recordkeeping.** `workshop_approvals` captures approver
   name/CRD/date and a snapshot of the exact `workshop_materials` versions approved. Every
   invitation/landing/slide/handout is a versioned `workshop_materials` row with a 2210
   classification and filing decision field.
3. **Securities firewall.** `is_security=true` excludes a workshop from the automated comms
   engine (gate step 7 already routes `isSecurity` to FFS); purple marker in staff UI; no
   securities account/order/suitability data stored anywhere in these tables.
4. **AI red-line.** Any AI-drafted invite/reminder/nurture body passes
   `validateAIClientMessage()` (no individualized product/investment recommendation) before
   dispatch — mass communications stay educational-only.
5. **TX/TDI seminar-labeling.** Landing/invite copy carries the required disclosures;
   where an event is an insurance sales solicitation, the "insurance sales presentation"
   equal-prominence disclosure is rendered. Disclosure text is **approval-driven config,
   never fabricated** (`is_assumption` + gold badge until verified).
6. **A2P/TCPA.** Separate, unchecked, optional SMS consent; full disclosure copy; STOP/HELP;
   quiet-hours (recipient-local 9–8 floor via the gate); durable evidence in
   `workshop_consent_events`. Brand/campaign 10DLC registration is a firm/carrier task.
7. **CAN-SPAM.** Physical address + one-step unsubscribe + non-deceptive subject on every
   commercial email (reuse existing footer/unsubscribe infra).
8. **Recording consent (virtual/hybrid).** Registration checkbox + at-start disclosure;
   strictest-applicable-state rule. Recording is itself a retained communication.
9. **Retention (17a-4 / 4511).** Every asset + every send + recording captured to the
   audit/retention trail before first use; PII (DOB etc.) encrypted per §5, RLS-scoped.

### REQUIRES-APPROVAL register (owner: **Ryan Anderson, FFS compliance**, unless noted)

| # | Item | Why it needs sign-off | Owner |
|---|---|---|---|
| R1 | 2210 classification per asset (retail/institutional/correspondence) | Content- and audience-dependent | Ryan Anderson (principal) |
| R2 | Principal pre-approval of every invite/landing/slide before publish | Rule 2210 | Ryan Anderson (principal) |
| R3 | FINRA filing decision + timeline per asset (pre-use / within-10-days / exempt) | Firm/FINRA determination — **not asserted as settled** | Ryan Anderson / FINRA Ad Reg |
| R4 | TX/TDI "insurance sales presentation" equal-prominence disclosure wording | Confirm current 28 TAC text | Ryan Anderson / TX legal |
| R5 | Senior-designation vetting for senior-targeted marketing (NAIC model) | Deceptive-designation rule | Ryan Anderson |
| R6 | SMS: 10DLC brand/campaign registration + template approval + transactional-vs-marketing classification | Carrier + TCPA | Ryan Anderson / carrier admin |
| R7 | Recording-consent disclosure language | All-party-state law | Ryan Anderson / legal |
| R8 | Retention schedule + capture of SMS + recordings to a 17a-4/4511 archive | Firm WSP defines exact periods | Ryan Anderson |
| R9 | Marketing Rule 206(4)-1 applicability if any IA activity/testimonial appears | BD-vs-IA character | Ryan Anderson |
| R10 | Free-lunch framing review for any senior/retiree event | 2007 joint-report guidance | Ryan Anderson |

*No filing obligation, classification, or state rule is asserted as settled in this spec.
Every such determination is deferred to the owners above.*

---

## 9. Phased implementation plan (P0 → P3)

Each item lists the primary files/objects touched and the backend risk. **All contingent
on approval of this spec; P0 additionally contingent on R2/R4/R6 disclosure text so the
public surface never ships fabricated disclosures.**

### P0 — Spine: model + RLS + publish gate + landing/registration + consent evidence
*Nothing publishes without approval.*
- **Schema (proposal `038`):** `workshop_sessions`, `workshop_consent_events`,
  `workshop_approvals`, `workshop_materials`; additive columns on `workshops`
  (`slug`, `delivery_mode`, `is_security`, `compliance_approval_ref`, status widening) and
  `workshop_registrations` (`session_id`, `chosen_delivery`, `join_token`, `lead_source`);
  RLS policies mirroring `018`/`010`; publish trigger. **Risk: MEDIUM** — status-check
  widening + trigger on a live table; must default existing rows to `draft` and not break
  the current `events/[id]` render.
- **Publish gate:** extend `PATCH /api/workshops/[id]` with the approval check;
  `WorkshopStatusControl` gains `pending_review`; new `/compliance/workshops` queue + a
  `POST /api/workshops/[id]/approve` route (compliance rbac). **Risk: MEDIUM** — this is
  the core control; must be defense-in-depth (route + trigger). Guardrail: never a
  force-publish path.
- **Public landing + registration:** `/workshops`, `/workshops/[slug]`,
  `/workshops/[slug]/register`, `/workshops/[slug]/confirmed`; extend `WorkshopRegisterForm`
  (delivery choice, hardened consent block, disclosures); keep `/events` → 301. Extend
  `POST /api/public/workshops/register` to write `workshop_consent_events` + `lead_source`
  + provision `join_token`. **Risk: LOW–MEDIUM** — reuses the public shell + existing route
  pattern; care on the honeypot/rate-limit path and the consent-evidence write.
- **Zod:** extend `WorkshopCreateSchema`, `WorkshopRegisterSchema` (delivery, session,
  consent fields). **Risk: LOW.**

### P1 — Ops: attendance/check-in + dashboard + reporting
- `workshop_attendance` table; `/app/workshops/[id]/check-in` (kiosk); extend
  `WorkshopRegistrations` (attendance + convert); `/app/workshops` dashboard
  (`StatTile`/`DashboardShell`), per-workshop report (`ReportShell`); attendance-reconcile
  route. **Risk: LOW–MEDIUM** — mostly read/aggregate; check-in offline tolerance is the
  one edge to design.

### P2 — Conversion: reminders + segmented post-event nurture
- FSOS confirmation template via `dispatch()`; GHL reminder + post-event workflows (new WFs
  by tag); lead-score push; consult routing reuses the `referrals→opportunities→reviews→
  appointments` spine. Tag/`lead_source` binding in `ghl.ts`. **Risk: MEDIUM** — cross-system
  (GHL + dispatcher); quiet-hours + consent gating must be proven per channel; the "45
  workflows" are manual-confirm in GHL, so this needs GHL-side build + verification.

### P3 — Delivery + polish: Zoom/virtual + hybrid + feedback + replay
- `POST /api/webhooks/zoom` (HMAC) → attendance; per-registrant `join_url` provisioning;
  hybrid switch flow; `/workshops/[slug]/replay` + `workshop_feedback`; finite-window
  recording; `.ics` + Add-to-Calendar generation. **Risk: MEDIUM** — Zoom webhook
  idempotency + registrant-token correlation (events fire multiple times); recording is a
  retained communication (R7/R8).

---

## 10. Open questions & assumptions

**Open questions (need Markist / Ryan input):**
1. **Route naming:** adopt `/workshops` + 301 from `/events`, or keep `/events`? (Spec
   assumes `/workshops` with a permanent redirect so no live link breaks.)
2. **Virtual platform:** Zoom assumed. Is there an existing Zoom account/API, or is GHL's
   native webinar/calendar preferred? Changes P3 provisioning.
3. **Consult booking tool:** Calendly (webhook exists) vs GHL calendars vs Google Calendar
   direct — which is canonical for the post-event consult?
4. **Sessions:** confirm the workshop-has-many-sessions model (vs one workshop = one event).
   Spec assumes multi-session; the scaffold today is single `scheduled_at`.
5. **Disclosure text:** exact TDI + 2210 + recording-consent copy must come from Ryan
   before any public page ships (R2/R4/R7).
6. **Retention archive:** where do SMS + recordings land for 17a-4/4511 capture? (R8.)
7. **10DLC:** is the SMS brand/campaign already registered for this traffic type? (R6.)

**Assumptions (all reversible / config-default, assumption-badged in UI):**
- Quiet-hours floor 9am–8pm recipient-local (matches existing gate).
- Reminder cadence and lead-score deltas are config defaults, not Farmers facts.
- Benchmark targets in §2.2/§5 are planning ranges shown with the gold badge.
- `left_early` duration threshold is a config default.
- Replay window default (e.g. 7–30 days) is a business/compliance choice, not fixed here.
- Build on the `018` spine registration route; the legacy customer-linked route is deprecated.

---

## Appendix A — Sources (research pass)

**Funnel / architecture:** wolf.financial; amraandelma webinar-funnel-statistics;
on24 2025 benchmarks; vantagepoint.io; storyamplify; getcontrast webinar-benchmarks;
univid; demandsage; nunify event-attendance-rate; repurposemywebinar; clickmeeting;
cvent; cloudpresent follow-up-sequence; properexpression; Zoom devforum (registrant join
link) + developers.zoom.us meeting webhooks; liquidweb attendance tracking; eventhex /
gocadmium hybrid; litmus / addevent add-to-calendar.

**Compliance:** FINRA Rule 2210 + Advertising-Regulation FAQs + "What & When to File";
FINRA Free-Lunch Seminars report (2007, p036814); NASAA Free Lunch Monitor + 2008
SEC-NASAA-FINRA senior report; TDI 28 TAC Ch. 21 Subch. B + annuity-products/certification;
NAIC senior-designation model regulation; SEC Marketing Rule 206(4)-1 (17 CFR 275.206(4)-1);
TCPA / A2P 10DLC (infobip, 10dlc.org); FTC CAN-SPAM guide; call/meeting recording-consent
guides; SEC 17a-4 / FINRA 4511 (FINRA Notice 17-18, smarsh, pagefreezer).

*Two primary pages (FINRA "What & When to File", Zoom webhook docs) were proxy-blocked
(403) and summarized from search results + the FINRA rule/FAQ pages — worth a direct read
before finalizing exact filing-timeline language.*
```
