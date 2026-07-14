# FSOS Part 2 — Page Specs: Agency-Owner · Client · Admin · Super Admin Portals

> Override specs on top of `../archetypes.md`. Each portal is RLS-scoped and column-allowlisted per `../middleware-auth.md`. The client and partner portals enforce the securities firewall by construction: they can never render securities substantive data.

---

## P-4 · Agency-Owner Portal (`/partner`)
Scope: `agency_id ∈ current_user_agencies()`. The owner sees only their own agency's data.

### Partner Dashboard
- **Route/Archetype:** `/partner` · A1 · agency_owner
- **Widgets:** my referrals + status, my production (attributed), attributed commissions (**only if config permits comp disclosure**), upcoming meetings, action items, approved materials shortcut.
- **Acceptance:** commission widget hidden entirely when disclosure config is off; no other agency's data ever visible.

### Submit Referral
- **Route/Archetype:** `/partner/refer` · A5 · agency_owner
- **Fields:** referred name (req), contact, product interest, engagement preference, **consent capture** (channel + disclosure text). **Validation:** Zod; consent required before any FSA outreach can follow.
- **Automations:** creates `referral` attributed to this agency; notifies FSA; starts SLA clock. **Audit:** create logged.
- **Acceptance:** referral appears in the FSA inbox immediately with agency attribution; consent recorded with source=partner_portal.

### My Referrals / Referral Status
- **Routes/Archetype:** `/partner/referrals` (A2), `/[id]` (A3)
- **Data:** this agency's referrals + status (received→working→converted/declined). **Compliance:** shows status only — no securities substantive detail, no client PII beyond what the owner submitted.
- **Acceptance:** owner sees progress, not the FSA's private notes or any securities case content.

### Production / Attributed Commissions
- **Routes/Archetype:** `/partner/production` (A11), `/commissions` (A2)
- **Production:** referral→placement counts + premium attributed to this agency. **Commissions:** attributed split amounts — **permission-gated; rendered only where config permits comp disclosure to the owner.**
- **Compliance/UI:** any split shown carries the "config default — verify" note if not contract-confirmed. **Audit:** view logged.
- **Acceptance:** if disclosure config off, the page is not reachable (nav hidden + 403 on deep link).

### Materials / Schedule / Training / Messages / Tasks / Settings
- **Routes/Archetype:** A2/A6/A2/A2-timeline/A2/A10
- **Materials:** approved-only content. **Schedule:** book a meeting with the FSA (Google Calendar or manual). **Messages:** consented comms with the FSA (through gate). **Tasks:** action items assigned to the agency. **Settings:** partner profile + notification prefs.
- **Acceptance:** only approved materials shown; messages honor consent/quiet-hours; no securities content anywhere.

---

## P-5 · Client-Facing Portal (`/client`)
Scope: `household_id = current_user_household()` + column allowlist excluding all securities/advice/commission fields. **Firewall by construction.**

### Client Home
- **Route/Archetype:** `/client` · A1-lite · client
- **Widgets:** upcoming appointments, outstanding document requests, assigned education, preferences/consent shortcuts.
- **Acceptance:** no policy financials beyond permitted review info; no securities data; no recommendations.

### Schedule / Intake
- **Routes/Archetype:** `/client/schedule` (A6), `/intake` (A6)
- **Schedule:** book appointment (types the FSA exposes). **Intake:** structured intake forms (needs-discovery inputs), Zod-validated, saved to the household.
- **Automations:** confirmations/reminders through the gate. **Audit:** submissions logged.
- **Acceptance:** intake captures needs data for the FSA's review; it never returns a recommendation.

### Documents / Document Requests
- **Routes/Archetype:** `/client/documents` (A5 upload), `/documents/requests` (A2)
- **Upload:** virus-scanned, signed-URL storage, classified to the household/case. **Requests:** outstanding items the FSA/case needs.
- **Acceptance:** uploads land against the correct case requirement; malicious files rejected.

### Education / Appointments / Profile / Preferences / Consent / Reviews / Case-Status
- **Routes/Archetype:** A2/A2/A5/A5/A5/A2/A3-lite
- **Education:** assigned neutral educational materials (permanent-life education permitted; no product recommendation). **Preferences/Consent:** manage channels; revoke instantly honored. **Reviews:** permitted policy-review info only. **Case-status:** non-securities milestones only, where allowed.
- **Compliance:** every screen is column-allowlisted; a securities field can never be selected into a client response. **Audit:** consent changes + views logged.
- **Acceptance:** revoking consent immediately suppresses all channels; case-status shows non-securities milestones only; no recommendation surface exists.

---

## P-2 · Admin / Back-Office Portal (`/admin`)

### Admin Dashboard
- **Route/Archetype:** `/admin` · A1 · admin, ops, case_manager
- **Widgets:** case processing queue depth, document-verification backlog, import jobs, support tickets, data-quality flags.

### Cases Queue / Document Processing / Verify
- **Routes/Archetype:** `/admin/cases` (A2), `/admin/documents` (A2), `/documents/verify` (A2)
- **Cases:** operational processing view of cases (assigned). **Documents:** classify/route uploaded docs. **Verify:** signature/form-version verification.
- **Compliance:** securities cases remain pointer-only; verification never stores securities suitability. **Audit:** actions logged.

### Data Imports (wizard) / Import Job / Exports / Duplicates
- **Routes/Archetype:** `/admin/data/imports` (A6), `/imports/[id]` (A3), `/exports` (A2), `/duplicates` (A2)
- **Import wizard steps:** upload CSV → field mapping → validation → preview → commit → error report → (rollback). Entities: agencies, households, policies, referrals, opportunities, commissions, documents. **Dedupe** on email/phone/policy#.
- **Automations:** import writes audit + rollback token. **Acceptance:** preview shows exactly what will change; errors reported per row; rollback restores pre-import state; no partial-commit corruption (idempotent).

### Support Requests / Users
- **Routes/Archetype:** `/admin/support/requests` (A2 + `/[id]` A3), `/admin/users` (A2)
- **Users:** invite, reset, unlock, **impersonate-with-audit** (persistent banner + audit event). **Support:** inbound public support tickets triaged.
- **Audit:** impersonation + user actions logged.

### Operational Config
- **Route/Archetype:** `/admin/config/[section]` · A10
- **Sections:** tags, statuses, loss reasons, appointment types, review types, templates. **Audit:** every change before/after.
- **Acceptance:** config drives dropdowns app-wide; Farmers-specific values badged "config default — verify."

---

## P-6 · Super Admin Portal (`/super`)
super_admin only, MFA mandatory + step-up. Every action heavily audited.

### Control Dashboard / Health
- **Routes/Archetype:** `/super` (A1), `/super/health` (A1)
- **Widgets:** system health, job queue depth, error rate, AI spend, backup status, integration health.

### Users / Roles / Permissions
- **Routes/Archetype:** `/super/users` (A2), `/roles` (A2), `/permissions` (A10)
- **Permissions:** the RBAC matrix (Part 4) is edited here. **Audit:** every grant/revoke logged.
- **Acceptance:** removing a permission immediately hides nav + 403s deep links for affected users.

### Org / District / Agency / Carrier / Product / Product Config / States
- **Routes/Archetype:** A2 (+ `/products/[id]` A10, `/states` A10)
- **Product config:** family, subtype, is_security, required_license, **conversion_window (config default, assumption-flagged)**, active. **States:** rules + quiet hours per state.
- **Compliance:** product availability + conversion windows + carrier rules are editable config defaults, never invented. **Audit:** logged.
- **Acceptance:** setting is_security on a product propagates the firewall to every opportunity/case using it; empty product catalog blocks opportunity create with a guided message.

### AI Config (agents / prompts / models / policies / sandbox)
- **Routes/Archetype:** A2/A2/A10/A10/A3
- **Policies:** approval policies + **kill switches** (per-agent + global gateway). **Models:** Claude-first routing + fallbacks + cost caps. **Prompts:** versioned. **Sandbox:** test an agent against sample data before production.
- **Compliance:** the Compliance Guardrail agent cannot be disabled here without a second-factor confirmation + audit. **Audit:** all changes logged.
- **Acceptance:** a killed agent stops at next run start; prompt/model changes are versioned + reversible.

### Templates / Integrations / Integration Detail
- **Routes/Archetype:** `/super/templates` (A2), `/integrations` (A12), `/integrations/[id]` (A12)
- **Integrations:** Twilio, email provider, Google Calendar, Supabase, AI providers, document storage, webhooks. Status/connect/test/failure-log/recovery. **Never invents an unavailable Farmers/FFS API** — absent ones show the manual/CSV/reference-field fallback labeled placeholder.
- **Audit:** connect/disconnect/credential-change logged (secrets never displayed).

### Feature Flags / Audit / Retention / Security / Jobs / Job Detail / Webhooks / API Keys / Errors / Usage / Backups
- **Routes/Archetype:** A10/A2/A10/A10/A2/A3/A12/A10/A2/A11/A2
- **Jobs:** background/cron with retries + idempotency + failure. **Retention:** ≥7-yr policy + legal-hold interplay. **Backups:** status + restore-test results + independent pg_dump export. **Usage:** AI token/cost tracking. **Audit:** platform-wide log.
- **Acceptance:** a failed job is visible + retryable without duplication; restore test result is current; retention/legal-hold prevents premature deletion.

### Billing (placeholder)
- **Route/Archetype:** `/super/billing` · A10 · **P3 placeholder — build nothing unless FSOS is commercialized as multi-tenant SaaS.**

---

## Part 2 completeness note
Every page enumerated in `../sitemap.md` now has either (a) a full archetype inheritance (its cross-cutting behavior) plus (b) a page-specific override spec in this Part 2 set, or is a pure archetype instance (static/system pages) fully defined by `../archetypes.md`. Together with Part 1, this is sufficient for Claude Code to build each page to its Definition of Done. Parts 3 (end-to-end workflow maps), 4 (RBAC matrix + data/API map), and 5 (missing-requirement analysis already partially in `build-order.md`, + acceptance checklist already in `build-order.md`) remain as the deeper cross-cutting documents.
