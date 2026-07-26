# Three Life Campaigns — Launch Readiness Audit (Slice 1)

**Status:** Complete — report only, no code.
**Date:** 2026-07-26
**Scope:** Activate three campaigns for live sending — **Cross-Sell Life**, **Life Conversion**, **Win-Back Life** — email live now, SMS staged behind an A2P-approved flag.
**Method:** Code-verified against the live repo (migrations, `src/lib/comms/*`, API routes, wizards, UI). Not a live-DB audit — the Supabase, Twilio, and Resend MCP connectors require re-authorization this non-interactive session cannot perform (see §7).

> **Bottom line.** The comms engine, compliance gate, providers, templates/approval, and simulation are **built and functional end-to-end** — this is an activation, not a rebuild. Two gaps stand between "built" and "sending real people": (1) **audience→enrollment wiring** for Cross-Sell and Win-Back (their import wizards write to `contacts`, which the campaign engine cannot enroll), and (2) **member-scoped consent capture** (no import path writes `consents` rows, so every imported record hard-blocks at the gate). Email deliverability needs a verified Resend domain (an ops/DNS gate, not code). SMS needs one new gate flag plus SMS templates. None of this requires touching the engine, gate, providers, or schema spine.

---

## 1. Platform trace — does the engine run end to end today?

**Yes, the canonical `comm_*` engine runs the full loop: enroll → schedule → gate → send → track.** (There is also a *dormant* legacy `campaigns` engine on `customers`/`scores` tables, not wired to any cron — ADR-013 reconciliation, out of scope here. Do not touch it.)

| Stage | Where | Status |
|---|---|---|
| Create | `POST /api/comms/campaigns` (`campaigns/route.ts:25`) — Zod-validated; requires an **approved** template, channel match, sequence for drip. Inserts `comm_campaigns` `status:'draft'`. | ✅ |
| Simulate (required) | `POST /api/comms/campaigns/[id]` `action:'simulate'` — persists `simulated_at` + `last_simulation`. | ✅ |
| Activate | `action:'activate'` — **422 `simulation_required`** without a simulation inside a 24h freshness window (`simulation-core.ts:67`); then `dispatchCampaign` → `status:'active'`. | ✅ |
| Enroll | `dispatchCampaign()` (`campaign.ts:170`) — broadcast inserts `comm_campaign_enrollments` per recipient (unique `(campaign_id, member_id)` = idempotent); drip seeds `current_step:0, next_send_at:now`. | ✅ |
| Schedule / cron | Vercel cron `/api/cron/campaign-dispatch` daily `0 12 * * *` (`vercel.json:6`) → `campaignDispatch()` (`jobs/handlers.ts:135`) dispatches broadcasts + `dripAdvance()` walks due enrollments, checks step template approval, sends, advances `current_step`/`next_send_at`. | ✅ (coarse — daily, not 30-min) |
| Gate | `sendThroughGate()` (`send.ts:282`) builds gate context fresh at send time → pure `evaluateGate()` (`gate.ts:129`) → allow: provider send; block: `compliance_events` + escalation + audit, **no force-send path**. | ✅ |
| Send | `dispatcher.send` → `messaging.ts` `sendSms()` (Twilio raw fetch S2S) / `sendEmail()` (Resend SDK). SMS gets TRAIGA footer appended (`dispatcher.ts:142`). | ✅ |
| Track | Email HTML instrumented with open pixel + click redirect (`tracking.ts`); `/api/track/open|click/[id]` + Twilio status webhook + inbound replies write `comm_message_events`; STOP → revoke consent + `dnc_entries`. | ✅ |

**Note:** actual provider sends live in `src/lib/messaging.ts`, **not** `comms/resend.ts` / `comms/twilio.ts` (those are webhook-signature verification only).

### The compliance gate (already enforced — trust it, do not duplicate)

`evaluateGate()` is a pure, tested function; first failing step wins (`gate.ts:129-161`):

| Order | Step | Escalates |
|---|---|---|
| 0 | ownership (authoritative owner resolved) | yes |
| 1 | consent (valid channel consent) | yes |
| 2 | quiet_hours (**9am–8pm recipient-local**, TCPA floor) | yes |
| 2c | delegation (on-behalf-of authority in scope) | yes |
| 3 | dnc (do-not-contact / opt-out) | yes |
| 4 | approved_template (approved template **or** approved AI policy) | yes |
| 5 | recommendation (AI red-line / individualized CTA language) | yes |
| 6 | is_security (securities firewall §4.1) | yes |
| 6b | data_confidence (no specific claim on unverified data) | yes |
| 7 | other_rule (FFS/Farmers/carrier/state/federal) | yes |
| 2b/2d/2e | business_hours / frequency caps / collision | no (deferral) |

Consent, suppression, quiet hours, DNC, template approval, securities firewall, frequency, AI red-line — **all present and server-enforced**. Per the "ship, don't audit" philosophy, we add **no redundant blocks**; the only new hard stop we introduce is the SMS A2P flag (§6, Slice 7).

---

## 2. Do the three import wizards produce enrollable audiences?

**This is the load-bearing gap.** There are two disconnected data worlds:

- **Wizards write to `contacts`** (the CRM Contact Center).
- **Enrollment reads `household_members`** joined to `households`, via `resolveAudience` (`campaign.ts:46-91`). Audience `kind ∈ { all_consented | household_ids | cross_sell | conversion }` — **there is no kind that reads `contacts`**.
- **Consent is keyed to `member_id`** in `consents` (`send.ts:197-211`). An imported `contacts` row has no `member_id` and no `consents` record → gate step 1 hard-blocks it even if it were reachable.

| Wizard | Writes to | Reaches enrollment? | What it still needs |
|---|---|---|---|
| **Cross-Sell** (`CrossSellImportWizard.tsx` → `/api/app/crosssell/import`) | `contacts` only (`contact_type:'cross_sell'`, tags `no-life/pnc-book`) | **No.** `cross_sell` audience comes from view `v_cross_sell_gaps` (households holding P&C with `has_life=false`), which the CSV never feeds. | contacts→`household_members`+`household_policies` promotion (so the gap view detects "no life"), **and** member-scoped `consents`. |
| **Life Conversion** (`ConversionImportWizard.tsx` → `/api/app/conversions/import`) | Aggregate-root spine: sets `household_policies.conversion_deadline`, `is_with_us=true`, `is_security=false`; inserts named insured into `household_members`. | **Partially yes** — the only wizard that does. Setting the deadline surfaces the policy in `v_conversions_due` (the `conversion` audience source). | Only enriches policies **already in the book** (unmatched = dead end, "import District Book first"); **no consent row** written for the new member. |
| **Win-Back** (`WinBackImportWizard.tsx` → `/api/app/winback/import`) | `contacts` only (`source:'winback_life'`, tags `life-winback`) | **No.** There is **no `winback` audience kind**; blueprint `win-back-lapsed-check-in` uses `all_consented` (would blast everyone). | contacts→members promotion **or** a contacts-backed win-back audience kind, a dedicated win-back audience definition, **and** consent. |

**Consent finding (all three):** none of the wizards capture, validate, or write `consents`. DNC/unsubscribe from source files are stored only as **`contacts` tags** (`'dnc'`, `'email-unsubscribed'`) — cosmetic to the gate, which reads the `consents` table and `dnc_entries`, not tags. **Every imported record blocks pre-send until a member-scoped `consents` row exists.** No wizard requires a phone or email either (rows with neither still import).

**Origination bridges exist but send nothing:** `/api/app/{crosssell,winback,cross-sell}/originate` read the views/tagged contacts and create pipeline `opportunities` — not comm audiences or enrollments.

---

## 3. Is email sendable now?

**Code is ready; deliverability is an ops gate, not code.**

- `sendEmail()` (`messaging.ts:24`) requires `RESEND_API_KEY` + `RESEND_FROM_EMAIL`, and **fails closed** if the from-address still contains `yourdomain.com` (placeholder guard).
- **Plaintext alongside HTML: yes** — ADR-025 stored `body_text` is threaded as the multipart plaintext part (`send.ts:329,506`).
- **Domain verification is assumed, not code-checked.** There is no runtime "domain verified with Resend" check beyond the placeholder guard. **SPF/DKIM/DMARC must be confirmed in the Resend dashboard, and `RESEND_FROM_EMAIL` set to an address on the authenticated domain, before live email.** This is the single gate on live email (Slice 2).
- Could not verify the live domain this session — Resend MCP token expired (§7).

---

## 4. Simulation / dry-run path

**Shipped and working** (prior comms Slice 6/8). `simulateCampaign()` (`simulation.ts`) is DB-backed, **read-only**: no Twilio/Resend call, no `comm_messages` write. Per contact it produces resolved sender/ownership, template version, **fully rendered body**, `scheduledAt`, `wouldSend`, exact `excludedReason`, and a **`decisions` map of every gate step**. It reuses the exact live gate + resolvers (no duplicate logic) and fails safe. Activation is gated on a fresh (<24h) simulation.

- **API:** `action:'simulate'`. **UI:** `CampaignActivateControls` "Run simulation (safe preview)".
- **Minor gaps to address in Slice 5:** the UI renders only the **summary**, not the per-contact entry list (the engine produces up to 200 entries in `report.entries`, but the persisted `last_simulation` is summary-only). The simulation `decisions` map hardcodes the quiet_hours line to "pass" and uses a fixed `-6` offset for display (the real gate still evaluates recipient-local correctly). Surfacing per-contact entries is the Slice 5 deliverable.

---

## 5. Templates — seeded? Approval flow?

- **`comm_templates` ships empty** — zero `INSERT INTO comm_templates` in any migration or seed. Nothing lands as `approved`.
- **Approval is enforced and cannot be bypassed.** `approval_status ∈ ('draft','submitted','approved')` + `submitted_at`/`approved_at`/`approved_by`. `isTemplateApproved()` (`send.ts:183`) feeds gate step 4; unapproved → hard block + escalate. Approve/reject is restricted to `compliance`/`supervisor`/`super_admin` (an FSA cannot self-approve). **Any edit resets to draft** and forces re-approval. Campaign builder UI only lists approved templates.
- **Three authoring paths, all producing DRAFT rows:** (a) API/UI `POST /api/comms/templates`; (b) **library blueprints** (`library.ts`, 7 green-zone blueprints, ADR-023) → `POST /api/comms/library` seeds a draft; (c) **React Email registry** (`src/emails/registry.tsx`, ~30 components) → `scripts/build-email-templates.ts` (`npm run templates:build`) renders to stored HTML+plaintext + `render_sha`, upserts as draft v1.
- **Personalization registry** (`personalize.ts` `DEFAULTS`): `first_name, last_name, full_name, agency_name, fsa_name, city`. **Missing for our content: `booking_link`** (the primary CTA), no policy/quote reference token, no distinct represented-party token. Specific claims (conversion deadline, appointment time) are deliberately **not** merge tokens — governed by the data-confidence gate, not interpolated.

**The three campaigns exist only as email blueprints** (`coverage-gap-education`, `term-conversion-window-invite`, `win-back-lapsed-check-in`) — **no SMS blueprints**, and no `comm_campaigns` rows named for them. They must be created from blueprints/registry and approved.

---

## 6. SMS / A2P gate

- **A2P 10DLC is SUBMITTED, not approved.** `TWILIO_MESSAGING_SERVICE_SID` maps to the submitted A2P campaign in Twilio; `NEXT_PUBLIC_SMS_FROM` / `site.ts` `SMS_CONSENT.version = 'a2p-10dlc-2026-07-frisco'` is display copy only.
- **There is NO A2P-approved flag anywhere in the send path.** Grep of all `src/` for `a2p|10dlc|sms_enabled|smsApproved|sms_live` returns only config copy and comments — **no runtime gate**. The AI kill switch (`ai/kill-switch.ts`) is AI-scoped, not SMS-scoped. Today, if Twilio env vars are set, code will attempt SMS regardless of registration status.
- **Slice 7 deliverable:** add a single **A2P-approved gate flag** — cleanest as a new pure gate step (e.g. `sms_live`/`a2p_approved`) fed from `send.ts` context (env or a `comm_*` config-default flag, `is_assumption`-style), so every SMS provably passes it and blocks-and-holds while false; plus a defensive guard at the top of `sendSms()` (`messaging.ts:50`). While false, SMS steps **hold** (queued, not sent) and the campaign UI shows "pending A2P approval." Flipping the flag activates SMS with no further build.

---

## 7. Session/operational constraints (must be handed off)

The live, authenticated actions in Slices 2 and 6 **cannot be executed from this non-interactive session** and are handed off to the user as an exact runbook. The **Supabase, Twilio, and Resend MCP connectors all require re-authorization** (tokens expired / OAuth flow unavailable headless). What this session delivers vs. hands off:

- **Delivered here (code/config/tests, build-verified):** the audience→enrollment + consent wiring (§2), SMS templates + blueprints, the A2P gate flag (§6), simulation per-contact surfacing (§4), CAN-SPAM/plaintext confirmation, migrations, and tests.
- **Handed off (needs authenticated access):** verifying the Resend domain + adding DNS records, sending the real seed test email, seeding/approving templates in the live DB, importing real audiences, and flipping the A2P flag on approval. Slice 2 outputs the exact DNS records and Slice 6 the exact enroll/activate steps.

---

## 8. Per-campaign checklist for Slices 2–7

Legend: ✅ built · ⚠️ built-but-gap · ❌ missing.

### Shared (all three)
- ✅ Engine loop, gate, providers, simulation, template approval, tracking.
- ❌ **Member-scoped consent capture on import** → Slice 3 (wire `consents` writes into the import paths; require a channel identifier).
- ❌ **`booking_link` personalization token** → Slice 4.
- ⚠️ **Resend domain verification + `RESEND_FROM_EMAIL`** → Slice 2 (ops/DNS; runbook).
- ❌ **A2P-approved SMS gate flag** (+ UI "pending A2P" state) → Slice 7.
- ⚠️ **Simulation per-contact entries in UI** → Slice 5.

### Cross-Sell Life
- ❌ **Audience bridge:** contacts→`household_members`+`household_policies` promotion so imports appear in `v_cross_sell_gaps` (or a contacts-backed `cross_sell` audience kind) → Slice 3.
- ✅ `coverage-gap-education` email blueprint exists → Slice 4 authors final email + **new SMS template**.
- Campaign row (`comm_campaigns`) + sequence → Slice 3; simulate → 5; live email → 6; SMS staged → 7.

### Life Conversion
- ⚠️ **Audience:** wizard bridges to the spine (best-positioned); needs consent write + a path for **unmatched policies** (currently dead-ends) → Slice 3.
- ✅ `term-conversion-window-invite` blueprint (`claimFields:['conversion_deadline']`) — deadline claim is data-confidence-gated → Slice 4 authors final email + **SMS template**; **exclude unverified deadlines** (raise for review, don't guess).
- Campaign + sequence → 3; simulate → 5; live email → 6; SMS staged → 7.

### Win-Back Life
- ❌ **Audience:** no `winback` audience kind at all; needs a dedicated definition (contacts-backed kind or promotion) — the blueprint's `all_consented` would blast everyone → Slice 3.
- ✅ `win-back-lapsed-check-in` blueprint (`claimFields:['policy_status']`) → Slice 4 authors final email + **SMS template**.
- Campaign + sequence → 3; simulate → 5; live email → 6; SMS staged → 7.

---

## 9. What NOT to touch (confirmed in scope guardrails)

- Do **not** build a second engine, gate, template system, or `/app/marketing/*`.
- Do **not** modify `lib/comms` internals beyond what activation requires (the A2P gate step + audience/consent wiring are additive).
- Do **not** touch the frozen GHL code or the social module.
- Do **not** fire live SMS to real contacts before A2P approval.
- Do **not** revive the dormant legacy `campaigns` engine (ADR-013 reconciliation is separate).

## 10. Slice sequence (email-first, so revenue starts before A2P clears)

1. **Slice 1 (this doc)** — audit + gap list. ✅
2. **Slice 2** — Resend domain verification + DNS runbook + CAN-SPAM/plaintext confirmation.
3. **Slice 3** — the three campaign definitions + **audience→enrollment + consent wiring** (the real gap).
4. **Slice 4** — email + SMS content authored and approved through the existing gate; add `booking_link` token.
5. **Slice 5** — simulation per-contact surfacing + clean dry-run for each campaign.
6. **Slice 6** — go live on email: enroll real audiences, activate email steps, watch tracking.
7. **Slice 7** — stage SMS behind the A2P-approved flag.

Each slice is its own draft PR, TDD, stop-for-review.
