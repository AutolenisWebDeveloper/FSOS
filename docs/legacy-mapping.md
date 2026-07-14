# FSOS Legacy → Aggregate-Root Mapping

> **Source of truth** for how the pre-existing "Command Center / GHL" schema and
> modules relate to the aggregate-root spine introduced in migrations `009+`.
> Per the C1–C6 build decisions: **legacy tables and modules are kept in place and
> left untouched. Nothing is renamed or dropped.** The new spine is additive
> (fresh migrations), and this document is the reconciliation reference.

## Decision recap (C1–C6)

| # | Decision |
|---|---|
| C1 | Aggregate-root spine ships as **fresh** migrations (`009_aggregate_root_core.sql`, `010_rls_guardrails.sql`). Legacy tables stay; none renamed/dropped. |
| C2 | Tailwind + shadcn/ui added as Foundation task 1 (new UI only; legacy inline screens keep their styling). |
| C3 | Route groups `(public)/(fsa)/(admin)/(compliance)/(partner)/(client)/(super)` introduced; existing public routes (`/[slug]`, `/upload/[slug]`, `/forms/[formId]`) remain public. |
| C4 | Existing `lib/compliance.ts` constants (FINRA/TRAIGA, green/red action lists, GDC tiers) are **reused as inputs** to the new structured guardrail libs — not recreated. |
| C5 | Existing `lib/anthropic.ts` is **wrapped** by `lib/ai/gateway.ts` (the model-agnostic gateway) — direct SDK calls elsewhere are prohibited going forward. |
| C6 | Legacy modules (`api/gdc`, `api/opra`, `api/scores`, GHL flows, GDC tiers) remain **as legacy, untouched**, and are not part of the aggregate-root build. |

## Name-collision avoidance

Three new spine tables were renamed to avoid colliding with legacy tables of the
same name (a `CREATE TABLE IF NOT EXISTS` would otherwise silently skip and leave
the legacy schema in place). The legacy tables are unaffected.

| Legacy table (kept) | New spine table |
|---|---|
| `policies` (migration 001) | **`household_policies`** |
| `campaign_enrollments` (migration 006) | **`comm_campaign_enrollments`** |
| `tasks` (migration 005) | **`work_tasks`** |

## Table mapping (legacy → aggregate-root)

| Legacy table | Aggregate-root equivalent | Notes |
|---|---|---|
| `agencies` (text PK, e.g. `ag1`) | `agency_partnerships` (uuid PK) | Different PK type. Migrate via CSV import (WF-11) later; no FK bridges the two. `agencies` is a flat GHL agency list; `agency_partnerships` is the aggregate **root** with status/relationship/rollups. |
| `agency_referrals` | `referrals` | New model adds engagement type, SLA timers, consent linkage, attribution to `agency_partnerships`. |
| `agency_uploads`, `ghl_upload_batches`, `ghl_upload_rows` | `documents` / import pipeline (P1) | Legacy GHL bulk-upload bookkeeping stays for the legacy flows. |
| `customers` | `households` + `household_members` | Legacy is person-centric; new model is household-centric with encrypted DOB (`household_members.dob_enc`). |
| `customer_profiles` | `households` (+ `reviews` needs-analysis) | Profile/needs data folds into household + review outcomes. |
| `customer_documents` | `documents` | New `documents` adds classification, retention, legal-hold. |
| `consent_ledger` | `consents` (+ `dnc_entries`) | New model is per-member per-channel with revocation authoritative at send time (WF-9). |
| `policies` (legacy) | `household_policies` | New adds `is_security`, `ffs_case_ref`, `conversion_deadline`, `x_date`, `is_with_us`. |
| `scores` | *(no equivalent — legacy scoring)* | Legacy lead-scoring; not part of the spine (C6). |
| `commission_rates` | `commission_splits` | New splits are **assumption-flagged** (`is_assumption=true`) and CHECK-constrained to sum 100; per-agency overrides supported. |
| `commission_cases` | `commissions` (+ `opportunities`, `cases`) | Legacy combined case+commission; new model separates the pipeline (`opportunities`), servicing (`cases`), and payout (`commissions`). |
| `opra_cases` | *(no equivalent — legacy OPRA)* | Legacy module; kept untouched (C6). |
| `workshops`, `workshop_registrations` | `appointments` / events (P1) | Legacy event flow; public `/events` remains. |
| `form_submissions`, `form_sends` | `document_requests` / intake (P1) | Legacy forms system; public `/forms/[formId]` remains. |
| `activity` (singular) | `activities` (plural, new) | Distinct tables; new `activities` is the spine activity log. |
| `campaigns`, `campaign_enrollments` | `comm_campaigns`, `comm_campaign_enrollments` | New comms model routes every send through the 7-step dispatcher gate. |
| `tasks` (legacy) | `work_tasks` | New tasks carry entity linkage + source (manual/workflow/agent). |
| `daily_briefings` | Executive Intelligence agent output (P1) | Legacy briefing generator; superseded by the agent roster. |

## New tables with no legacy antecedent

`regions`, `districts`, `agency_owners`, `agency_activation`, `carriers`,
`products`, `coverages`, `reviews`, `opportunities`, `cases`, `case_requirements`,
`comm_templates`, `comm_messages`, `document_requests`, `appointments`,
`ai_policies`, `ai_agents`, `agent_runs`, `agent_actions`, `compliance_events`,
`incidents`, `licenses`, `notifications`, `job_runs`, `audit_log`, `user_roles`,
`user_agencies`, `user_households`.

## Module mapping (code)

| Legacy code | Status | New counterpart |
|---|---|---|
| `lib/compliance.ts` | **Reused** (C4) | Feeds `lib/compliance/guardrail.ts` (green/red lists), `lib/comms/dispatcher.ts` (TRAIGA footer). Unchanged. |
| `lib/anthropic.ts` | **Wrapped** (C5) | `lib/ai/gateway.ts` is now the only permitted AI entry point. |
| `lib/messaging.ts` | **Reused** | The dispatcher calls `sendSms`/`sendEmail` after the gate passes. |
| `lib/supabase/client.ts` (`getDb`) | **Reused** | Unchanged; new `lib/supabase/server.ts` adds the RLS-respecting anon client for portals. |
| `src/middleware.ts` | **Extended** (C3) | Legacy `/` basic-auth preserved; portal gate added for the new portals. |
| `api/gdc`, `api/opra`, `api/scores`, `api/ghl/*` | **Legacy, untouched** (C6) | Not part of the aggregate-root build. |

## Guardrail enforcement points (where the three guardrails live in code)

| Guardrail | Enforced in |
|---|---|
| 1 — Securities firewall | `lib/compliance/firewall.ts` (payload assertion + `isSecurity`); RLS `pol_read` on `household_policies` (client never loads `is_security`). |
| 2 — AI green-zone / red-line | `lib/compliance/guardrail.ts` (`validateAIClientMessage`), applied in `jobs/agent-runner.ts` and the dispatcher. |
| 3 — No invented Farmers data | `commission_splits.is_assumption`, `products.conversion_window_is_assumption`; UI `AssumptionBadge` ("config default — verify"). |
| Comms 7-step gate | `lib/comms/gate.ts` (pure decision) executed by `lib/comms/dispatcher.ts`. |
| Audit (append-only) | `lib/audit/log.ts` → `audit_log` (INSERT-only + tamper-evident trigger, migration 010). |
