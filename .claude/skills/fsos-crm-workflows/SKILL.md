---
name: fsos-crm-workflows
description: Build and extend FSOS's core CRM spine and its workflow/integration plumbing — the aggregate-root data model, background agents, and GHL/Make automations. Use this whenever the task touches agency partnerships, referrals, households, financial reviews, opportunities, cases, commissions, the AI agent runner, GoHighLevel sync, Make.com scenarios, CSV/contact import, tasks, appointments, or pipeline stages. Reach for it even when the user just says "wire this referral to a case", "add a follow-up automation", "sync this to GHL", or "why isn't this opportunity advancing" — so the aggregate-root spine and the NIGO/securities exclusions are respected.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: crm-workflows
  guardrails: "2.1, 2.2, 3"
---

# FSOS CRM & Workflow Integration

Owns the operational heart of FSOS: the aggregate-root spine and the automations that move work along it. The single most important thing to internalize — and the reason FSOS is not a generic CRM — is the **aggregate root**.

## The aggregate root is the Agency-Owner Partnership

FSOS is a B2B2C referral/wholesale model. The root of the entire data model is the **Agency-Owner Partnership**, not a generic contact or deal. Build and reason in dependency order:

**Agency Partnership → Referral → Household → (Financial) Review → Opportunity → Case → Commission.**

The Financial Review layer is first-class — it is where policy/coverage/term-conversion/retirement/annual reviews happen and where opportunities originate. Do not flatten this into "contacts and deals" (CLAUDE.md §0, §5, `docs/build-order.md`).

## Authoritative sources — read, don't duplicate

- **Build order & spine:** `docs/build-order.md`, `docs/specs/workflows-core-spine.md`, `docs/specs/workflows-ops-compliance.md`, `docs/specs/cases-commission.md`, `docs/specs/review-conversion-crosssell.md`, `docs/specs/data-api-map.md`.
- **Data model & RLS:** `docs/data-guardrails.md`; schema `supabase/migrations/009_aggregate_root_core.sql`, `010_rls_guardrails.sql`, and later feature migrations.
- **Integrations:** `src/lib/ghl.ts`, `src/lib/ghlContacts.ts`, `src/lib/contacts/`, `src/lib/import/`, `src/lib/csv.ts`, `src/lib/spreadsheet.ts`; docs `docs/ghl_integration.md`, `docs/make_scenarios.md`.
- **Background jobs / agents (§6):** `src/jobs/agent-runner.ts`, `src/jobs/handlers.ts`, `src/jobs/index.ts`. Also `src/lib/jobs/`.
- **Apollo enrichment:** `src/lib/apollo.ts`.

## Rules

1. **Agents are durable background jobs, not chat sessions (§6).** Every agent run writes `agent_runs` (inputs, model, tokens, cost, confidence) and every action writes `agent_actions` (tool, target, outcome, audit link). The gateway and each agent have a kill switch checked at run start (`/super/ai/policies`).
2. **Green-zone agents only (§2.2).** The roster identifies, educates, invites, schedules, reminds, follows up, drafts internal materials, assembles data, and logs. No agent makes an individualized product/investment/replacement/allocation recommendation. Any client-facing action passes the Compliance Guardrail (see **twilio-a2p-compliance**) before dispatch.
3. **No NIGO on the spine (§3).** Case Management OS (`/app/cases`) stays NIGO-free — no NIGO scoring, defect categories, or cross-links onto `agency_partnerships → … → cases`. NIGO work lives only in the isolated Compliance Intelligence island (**fsos-nigo-intelligence**); never FK from `nigo_cases` into `cases`.
4. **Securities firewall (§2.1).** Track that a securities opportunity/case exists (stage, engagement model, referring agency, expected/actual commission) plus a non-substantive `ffs_case_ref`. Never store securities account numbers, order details, or suitability determinations. `is_security = true` records are excluded from the automated comms engine.
5. **Model calls go through the gateway.** Use `src/lib/ai/` / `src/lib/anthropic.ts` — never a provider SDK directly from a route or component (§1).

## Working here

- API routes keep `export const dynamic = 'force-dynamic'` / `export const runtime = 'nodejs'`, use `getDb()`, validate with Zod.
- Every create/update/delete on a client/agency table writes the append-only `audit_log` (`src/lib/audit/`) and respects RLS scope (see **fsos-security-audit**).
- GHL is a sync integration — treat unverified Farmers/FFS APIs as manual/CSV/secure-reference fallbacks (§2.3), not invented endpoints.

## When NOT to use this skill

- Send-path SMS/email compliance details → **twilio-a2p-compliance**.
- NIGO / suitability / knowledge-corpus work → **fsos-nigo-intelligence** / **finra-rule-ingestion**.
- Public marketing surface → **farmers-brand-website**.

## Validate before claiming done

- `npm run build` clean; `npm test` green (P0/P1 gates, `workforce`, `resolution`); `npm run test:rls` for any RLS change.
- Confirm no NIGO/securities-prohibited field or FK was added to the spine.
