# FSOS Legacy Port Specification

> **Decision:** FSOS keeps its architecture (per-user auth, MFA, RLS, portals, audit, securities firewall). The legacy Command Center's **character** (per `design-system.md`) and its **unique features** (this file) are ported *into* FSOS. The legacy shell is then retired and `/` redirects to `/app`.
>
> **Why not the reverse:** the legacy Command Center is a single 5,408-line client-side JSX file behind one shared HTTP Basic password, with no RLS, no per-user identity, no roles, and no audit. Moving a FINRA-regulated client system into it would destroy the compliance perimeter built across Foundation–P3. The look and the features are portable; the architecture is not worth trading.
>
> **Owner decisions recorded:** OPRA → **retire** (no longer used). Needs Map / Sales Calculator / Review Prep → **port** (in use).

---

## 1. Disposition table

| Legacy feature | Legacy API | Disposition | New FSOS route |
|---|---|---|---|
| FNA Generator | `api/forms/fna` | **PORT** | `/app/fna` |
| GDC & Commission | `api/gdc/cases` | **PORT (merge)** | `/app/commissions/gdc` |
| Client Forms | `api/forms/submit`, `api/forms/responses` | **PORT** | `/app/forms` |
| FFS Contacts | static | **PORT** | sidebar panel + `/super/config/ffs-contacts` |
| Workshops | `api/workshops/register` | **PORT** | `/app/workshops` |
| Contact Upload (GHL) | `api/ghl/contacts/upload`, `api/ghl/sync` | **PORT** | `/admin/data/imports/ghl` |
| Needs Map | client-side | **PORT** | `/app/reviews/[id]/needs-map` |
| Sales Calculator | client-side | **PORT** | `/app/tools/calculator` |
| Review Prep | `api/customers/meeting-prep` | **MERGE** | into `/app/reviews/[id]/prep` |
| Daily Briefing | `api/briefing/send` | **MERGE** | into `/app/briefing` |
| **OPRA Center** | `api/opra` | **RETIRE** | — (owner: no longer used) |
| Agency Owners | `api/agencies` | **RETIRE** | `/app/agencies` exists |
| Follow-Ups | — | **RETIRE** | `/app/tasks` exists |
| Conversions | `api/conversions` | **RETIRE** | `/app/conversions` exists |
| Campaigns | `api/campaigns` | **RETIRE** | `/app/comms/campaigns` exists |
| Reports | `api/reports` | **RETIRE** | `/app/reports` exists |
| Calendar | — | **RETIRE** | `/app/calendar` exists |
| AI Control Center | `api/ai` | **RETIRE** | `/app/ai` exists |
| Audit Log | `api/audit` | **RETIRE** | `/compliance/audit` exists |
| Dashboard | `api/dashboard` | **RETIRE** | `/app` exists |
| Contact Upload legacy UI | — | **PORT** | replaced by `/admin/data/imports/ghl` |
| Assistant | `api/assistant` | **EVALUATE** | fold into `/app/ai` if used; else retire |

**Rule for every ported page:** it is a *new FSOS page* built to the Definition of Done (`archetypes.md`) and `design-system.md` — real auth, RLS, audit on mutation, empty/loading/error states, responsive, accessible. It is **not** a copy-paste of legacy JSX.

---

## 2. Ported feature specs

### 2.1 FNA Generator — `/app/fna` **[A5 → A11]** *(P1)*
The highest-value keeper. Generates a Financial Needs Analysis report via the Anthropic API.

- **Roles:** fsa, licensed_staff.
- **Flow:** select household → auto-load member/DOB/policy/coverage context → optional notes → generate → review → save to Document OS → deliver via Document OS (never raw email).
- **Data:** reads `fsos_households`, `fsos_household_members` (DOB via the `SECURITY DEFINER` RPC), `fsos_policies`, `fsos_coverages`; writes `fsos_documents` (classification `fna_report`) + `fsos_activities`.
- **AI:** routes through `lib/ai/gateway.ts` — **never** the Anthropic SDK directly. Prompt is versioned in `/super/ai/prompts`.
- **🛡 COMPLIANCE — non-negotiable:**
  - The FINRA disclaimer renders **verbatim** on every report: *"For educational and informational purposes only. Not a product recommendation or suitability determination. Requires licensed FSA review per FINRA Reg BI."*
  - The output passes `lib/compliance/guardrail.ts` before it can be saved or delivered. Recommendation language → hard-block + escalate.
  - The FNA **identifies needs and gaps**. It must **never** name a specific product to buy. Same red line as Term Conversion.
  - If the household holds any `is_security` product, the report carries the purple FFS-managed marker and the securities portion routes to FFS — not generated here.
- **Audit:** `fna.generated`, `fna.blocked`, `document.created`, `fna.delivered`.
- **Acceptance:** disclaimer present verbatim; a recommendation-bearing draft is blocked in test; DOB read via RPC (never raw ciphertext); report saved as a document, not emailed ad hoc.

### 2.2 GDC & Commission — `/app/commissions/gdc` **[A1]** *(P1)*
Merges into the existing Commission OS as a tab, not a separate module.

- **Roles:** fsa (licensed_staff read).
- **Content:** rolling-12-month GDC total, current tier, distance to next tier, tier history, GDC pipeline snapshot (est. FSA payout by stage).
- **Tiers (⚠ assumption-flagged config, `/super/config/gdc-tiers`):** Tier 1 <$15,000 → 40% · Tier 2 $15,000–54,999 → 60% · Tier 3 $55,000+ → 80%. Every tier value carries the gold `CONFIG DEFAULT — VERIFY` badge.
- **Data:** derives from `fsos_commissions` (rolling 12mo); new table `gdc_tiers` (config, `is_assumption` default true).
- **Character:** feeds the sidebar **CURRENT GDC TIER** gold card (`design-system.md` §5.3B).
- **Audit:** `config.changed` on any tier edit (before/after).
- **Acceptance:** tier math matches config; no tier value presented as a Farmers-published figure.

### 2.3 Client Forms — `/app/forms` **[A2]** + `/app/forms/[id]` **[A3]** *(P1)*
The client intake portal (you had 8 pending responses).

- **Roles:** fsa, licensed_staff, admin/ops.
- **Content:** form templates, sent forms, pending/completed responses, response detail → attach to household.
- **Public surface:** existing `/forms/[formId]` stays public (it's on the allowlist) but is restyled to `design-system.md` and **must capture consent** with source `client_form`.
- **Data:** `form_templates`, `form_responses`; links to `fsos_households`; writes `fsos_documents` + `fsos_activities`.
- **🛡 Compliance:** no securities data collected on any public form. Honeypot + rate limit. Audit `actor='public'` on submission.
- **Acceptance:** a submitted form lands on the right household; consent recorded; pending count matches the sidebar badge.

### 2.4 FFS Contacts — sidebar panel + `/super/config/ffs-contacts` **[A10]** *(P1)*
- **Panel:** `design-system.md` §5.3C — QUICK ACCESS card in the sidebar, `tel:` links, DM Mono numbers.
- **Config-driven, not hard-coded.** Seed (editable): FSD Central (TX) Matt Anderson (818) 584-0264 · Internal Wholesaler Ando Agamalian (818) 584-0205 · Compliance TX Ryan Anderson (253) 242-0597 · OSJ Principal Mgr Lora Brandt (818) 584-0199 · Sales Desk (866) 888-9739 Opt 3→3, Mon–Fri 7AM–5PM PT.
- **Data:** `ffs_contacts` table (role, name, phone, hours, order).
- **Audit:** `config.changed`.

### 2.5 Workshops — `/app/workshops` **[A2]** + `/app/workshops/[id]` **[A3]** *(P2)*
- **Roles:** fsa, licensed_staff, admin.
- **Content:** workshop/seminar list, detail, registrations, attendance, → convert attendee to referral/household.
- **Public:** existing `/events/[id]/register` restyled; **consent captured at registration**.
- **Data:** `workshops`, `workshop_registrations`; links to `fsos_referrals`.
- **🛡 Compliance:** invitations run through the 13-step comms gate (`docs/data-guardrails.md` §5). Educational/event content only — no product pitch in automated invites.

### 2.6 Contact Upload (GHL) — `/admin/data/imports/ghl` **[A6]** *(P2)*
Folds into the existing Admin import wizard rather than a separate uploader.

- **Roles:** admin, ops, super_admin.
- **Flow:** upload/sync → field mapping → validation → **preview** → commit → error report → **rollback token**.
- **Data:** maps GHL contacts → `fsos_households` + `fsos_household_members` (+ consent). Dedupe on email/phone.
- **🛡 Compliance:** consent must be present or explicitly marked absent — **an imported contact with no consent cannot be messaged** (the gate blocks it). Never import securities data.
- **Acceptance:** idempotent; rollback restores pre-import state; imported-without-consent contacts are visibly flagged and unsendable.

### 2.7 Needs Map — `/app/reviews/[id]/needs-map` **[A3]** *(P2)*
Ported as a **tab inside the Review workspace**, where it belongs — needs discovery is the review's job.

- **Content:** visual coverage/needs map for the household — what's held, what's missing, life-stage context.
- **Data:** `v_cross_sell_gaps`, `fsos_policies`, `fsos_household_members`.
- **🛡 Compliance:** displays **gaps**, never a product recommendation. Output feeds the review outcome's structured needs capture. Framed as "coverage gap / discussion topic."

### 2.8 Sales Calculator — `/app/tools/calculator` **[A5]** *(P2)*
- **Roles:** fsa, licensed_staff.
- **Content:** the legacy calculators (needs-based coverage estimate, income replacement, etc.), client-side, no persistence unless attached to a review.
- **🛡 Compliance:** an **illustration/estimate tool**, not a recommendation engine. Every output carries: *"Educational estimate only. Not a product recommendation or suitability determination."* Results may be attached to a review as a discussion artifact.

### 2.9 Review Prep — merge into `/app/reviews/[id]/prep` *(P1)*
The legacy `api/customers/meeting-prep` logic folds into the existing Review prep workspace. Read-only assembly (policies, prior reviews, gaps, conversion windows) — **no recommendation**, per the existing spec.

### 2.10 Daily Briefing — merge into `/app/briefing` *(P1)*
Legacy `api/briefing/send` (email delivery) merges into the existing briefing page: add "Email me this briefing." The send routes through the **comms dispatcher gate** like everything else.

---

## 3. Retirement plan

**Retire (owner-confirmed / duplicated by FSOS):** OPRA Center + `api/opra` (+ `opra_cases` table → keep data, drop UI/routes), Agency Owners, Follow-Ups, Conversions, Campaigns, Reports, Calendar, AI Control Center, Audit Log, Dashboard, legacy Contact Upload UI.

**Rules:**
1. **Never drop a legacy table** in this phase. Retire *UI and routes only*. Data stays for retention/audit (≥7yr). Table drops are a separate, later decision.
2. Retire a legacy route **only after** its FSOS replacement is verified working with real data.
3. `api/scores` and `api/customers/*`: audit usage first — if the new spine covers them, retire; if something unique remains, port it.

---

## 4. Cutover plan (order matters)

**Do these in sequence. Do not skip ahead.**

**Step 0 — Security fix (blocking).** Migration `015_security_invoker_views.sql` — `security_invoker = on` for every view; extend `tests/rls-firewall.test.mjs` to prove the firewall on views, not just tables. **Nothing else ships first.**

**Step 1 — Fix the erroring `/app` pages.** Audit every route against the live schema; report `route | error | root cause`; fix. Get what exists working before adding more.

**Step 2 — Restyle (`design-system.md`).** Dark shell, DM Sans/DM Mono, mono labels, identity lockup, the three character panels, density, assumption + securities markers. This is where FSOS gets its soul back.

**Step 3 — Port P1 keepers.** FNA Generator, GDC & Commission, Client Forms, FFS Contacts, Review Prep merge, Daily Briefing merge.

**Step 4 — Port P2 keepers.** Workshops, GHL Contact Upload, Needs Map, Sales Calculator.

**Step 5 — Cutover.** `/` redirects to `/app`. Legacy shell moves to `/legacy` behind Basic auth for a defined grace period (default 30 days, config), with a banner: *"Legacy view — read-only. FSOS is now at /app."* Remove legacy nav entries whose FSOS replacement is live.

**Step 6 — Decommission.** After the grace period with no regressions: delete `fsos_command_center.jsx`, the legacy page shell, and the retired API routes. **Legacy tables stay.** Remove `FSOS_ADMIN_PASSWORD` basic-auth once `/` no longer serves legacy.

---

## 5. Acceptance criteria
- [ ] Every ported page meets the Definition of Done and `design-system.md`.
- [ ] FNA Generator: FINRA disclaimer verbatim; recommendation-bearing output blocked in test; DOB via RPC.
- [ ] GDC tiers: assumption-badged, config-editable, never presented as Farmers-published.
- [ ] Sidebar character panels (AI Live Status, GDC Tier, FFS Contacts) live and wired to real data.
- [ ] All public forms (client forms, workshop registration) capture consent + honeypot + rate limit; no securities data.
- [ ] GHL import: preview + rollback; no-consent contacts flagged and unsendable.
- [ ] Needs Map / Calculator output framed as gaps/estimates, never recommendations, with the educational disclaimer.
- [ ] No FSOS guardrail regressed: `npm test` green (guardrail proofs, P0/P1 gates, RLS-on-views).
- [ ] No dead nav links after retirement; every removed legacy item has a live FSOS replacement.
- [ ] `/` redirects to `/app`; legacy reachable at `/legacy` during grace only.
- [ ] NIGO appears nowhere.
