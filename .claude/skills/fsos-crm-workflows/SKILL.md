---
name: fsos-crm-workflows
description: Build and extend FSOS's core CRM spine and its workflow/integration plumbing — the aggregate-root data model, background agents, native communications campaigns/enrollments, and GHL/Make automations. Use this whenever the task touches agency partnerships, referrals, households, financial reviews, opportunities, cases, commissions, the AI agent runner, native comm campaigns/sequences/enrollments, delegated agency-owner outreach, GoHighLevel sync, Make.com scenarios, CSV/contact import, tasks, appointments, or pipeline stages. Reach for it even when the user just says "wire this referral to a case", "add a follow-up automation", "sync this to GHL", or "why isn't this opportunity advancing" — so the aggregate-root spine and the NIGO/securities exclusions are respected.
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

## Native communications: campaigns, enrollments, and the conversation lifecycle

The native comms platform (Slices 1–9) extends the CRM in-place under `src/lib/comms/` and `/app/comms` — it is **not** a parallel marketing platform, and GoHighLevel stays **frozen** (not extended, not removed). Campaign/enrollment plumbing lives here; the *send-path compliance* details live in **twilio-a2p-compliance**.

- **Enrollment lifecycle drives the drips.** `comm_campaign_enrollments` carries a status (`enrolled`, `paused_for_conversation`, …). The drip runner (`campaign-run.ts` `dripAdvance`) selects **only** `status='enrolled'`, so pausing an enrollment removes it from the population entirely — a *structural* guarantee, not a heuristic. Reuse this lifecycle; do not build a second scheduler.
- **A reply pauses promotional automation (§10).** On a genuine inbound reply, `inbound.ts` sets that member's `enrolled` enrollments to `paused_for_conversation` (audited). This is why FSOS never sends a "haven't heard back" follow-up after a customer has engaged. Resume is deferred: the `resume-paused` cron runs the pure `evaluateResume` (`conversation-mode.ts`) against the editable `comm_conversation_policy` (quiet-period is a config default, `is_assumption`) and returns eligible enrollments to `enrolled` — on a manual resume, a resolved/closed conversation, or the customer going quiet ≥ the configured window.
- **Simulation is required before activation (§14).** A campaign cannot activate without a recent read-only simulation pass on record (`comm_campaigns.simulated_at`; activate returns **422 `simulation_required`** otherwise). Treat activation as gated on a dry-run — see **twilio-a2p-compliance** for the simulator.
- **Delegated agency-owner outreach.** Outreach on behalf of an agency owner carries an actual-sender vs represented-party model and requires an ACTIVE, in-scope delegation; unresolved ownership routes to an assignment-review queue rather than sending (ADR-015/§6). The authority check is enforced in the gate (`delegation`/`ownership` steps); the campaign/enrollment side just supplies the represented agency.
- **Campaign/sequence builder config (Slice 7 / ADR-022, `campaign-config.ts`).** The builder stores the gate-relevant config earlier slices deferred: a single message `purpose` (§9/§10 — drives consent/frequency/priority) and an optional **delegated-sender** pairing (`represented_agency_owner_id` + the `delegation_id` authorizing the on-behalf-of send). Both are **default-permissive** — a campaign with neither dispatches exactly as before. `campaignSendConfig` (pure, no DB/clock) maps the stored row → the gate's SendContext pieces; a *partially* configured delegation (only one of the two fields) is NOT treated as delegated. The actual delegation row is resolved **fresh** at dispatch (`ownership.ts`), never trusted from the builder snapshot. Schema: migration `058`.
- **Campaign library blueprints (Slice 8 / ADR-023, `library.ts`; UI `/app/comms/library`).** A curated, **version-controlled** catalog of pre-built, compliance-ready blueprints (this is CODE, not invented Farmers data — §2.3): every blueprint is green-zone (education/invitation, no recommendation/call-to-action), footer-free (the dispatcher appends the TRAIGA disclosure + opt-out at send time), and purpose-tagged. "Add to templates" seeds a **DRAFT** `comm_templates` row that still passes human approval before any campaign can use it — the approval gate is never bypassed. Reuse `listBlueprints`/`instantiate`; do not hardcode a second blueprint set.
- **Claim-field declaration + resolver wiring (Slice 8 / ADR-024, `claims.ts` + `claim-resolver.ts`).** A campaign/blueprint **declares** the specific per-recipient claim fields its message rests on (`conversion_deadline`, `policy_status`, `appointment_at`). The read-only `claim-resolver.ts` derives each field's verified/conflicting state for one recipient household (fail-**closed** on missing/ambiguous), and pure `buildDataConfidence` (claims.ts) turns it into the gate's `data_confidence` input — an unverified/conflicting claim excludes the contact + raises a verification task (§13), never sent on a guess. A campaign declaring no claims is never blocked by this step. Schema: migration `059`.

## Authoritative sources — read, don't duplicate

- **Build order & spine:** `docs/build-order.md`, `docs/specs/workflows-core-spine.md`, `docs/specs/workflows-ops-compliance.md`, `docs/specs/cases-commission.md`, `docs/specs/review-conversion-crosssell.md`, `docs/specs/data-api-map.md`.
- **Data model & RLS:** `docs/data-guardrails.md`; schema `009_aggregate_root_core.sql`, `010_rls_guardrails.sql`, later feature migrations, and comms-native `049`–`061` (`058` builder purpose/delegation, `059` claim fields, `061` template render).
- **Native comms campaigns/enrollments:** `src/lib/comms/campaign.ts`, `campaign-run.ts`, `campaign-config.ts`, `conversation-mode.ts`, `simulation.ts`, `library.ts`, `claims.ts`, `claim-resolver.ts`; `/app/comms` (incl. `library/`, `assignments/`, `identity/`, `inbox/`). ADRs 013–025; slice docs `docs/comms-native/`.
- **Integrations:** `src/lib/ghl.ts`, `src/lib/ghlContacts.ts`, `src/lib/contacts/`, `src/lib/import/`, `src/lib/csv.ts`, `src/lib/spreadsheet.ts`; docs `docs/ghl_integration.md`, `docs/make_scenarios.md`.
- **Background jobs / agents (§6):** `src/jobs/agent-runner.ts`, `src/jobs/handlers.ts`, `src/jobs/index.ts`. Also `src/lib/jobs/`.
- **Apollo enrichment:** `src/lib/apollo.ts`.

## Rules

1. **Agents are durable background jobs, not chat sessions (§6).** Every agent run writes `agent_runs` (inputs, model, tokens, cost, confidence) and every action writes `agent_actions` (tool, target, outcome, audit link). The gateway and each agent have a kill switch checked at run start (`/super/ai/policies`).
2. **Green-zone agents only (§2.2).** The roster identifies, educates, invites, schedules, reminds, follows up, drafts internal materials, assembles data, and logs. No agent makes an individualized product/investment/replacement/allocation recommendation. Any client-facing action passes the Compliance Guardrail (see **twilio-a2p-compliance**) before dispatch; an AI message the code can't classify as low-risk is draft-only, never auto-sent.
3. **No NIGO on the spine (§3).** Case Management OS (`/app/cases`) stays NIGO-free — no NIGO scoring, defect categories, or cross-links onto `agency_partnerships → … → cases`. NIGO work lives only in the isolated Compliance Intelligence island (**fsos-nigo-intelligence**); never FK from `nigo_cases` into `cases`.
4. **Securities firewall (§2.1).** Track that a securities opportunity/case exists (stage, engagement model, referring agency, expected/actual commission) plus a non-substantive `ffs_case_ref`. Never store securities account numbers, order details, or suitability determinations. `is_security = true` records are excluded from the automated comms engine.
5. **Model calls go through the gateway.** Use `src/lib/ai/` / `src/lib/anthropic.ts` — never a provider SDK directly from a route or component (§1).
6. **GoHighLevel is frozen.** The native comms platform replaces GHL functionality in-place; do not extend or remove GHL as part of comms work — leave it untouched.

## Working here

- API routes keep `export const dynamic = 'force-dynamic'` / `export const runtime = 'nodejs'`, use `getDb()`, validate with Zod.
- Every create/update/delete on a client/agency table writes the append-only `audit_log` (`src/lib/audit/`) and respects RLS scope (see **fsos-security-audit**). New comms tables need `grant select … to authenticated` for RLS to *deny by row* rather than error on missing table grants — the RLS firewall proof depends on it.
- GHL is a sync integration — treat unverified Farmers/FFS APIs as manual/CSV/secure-reference fallbacks (§2.3), not invented endpoints.

## When NOT to use this skill

- Send-path SMS/email compliance details (the gate, consent, quiet hours, delegation authority, simulation dry-run) → **twilio-a2p-compliance**.
- NIGO / suitability / knowledge-corpus work → **fsos-nigo-intelligence** / **finra-rule-ingestion**.
- Public marketing surface → **farmers-brand-website**.

## Validate before claiming done

- `npm run build` clean; `npm test` green (P0/P1 gates, `workforce`, `resolution`, comms cores); `npm run test:rls` for any RLS change.
- Confirm no NIGO/securities-prohibited field or FK was added to the spine.
