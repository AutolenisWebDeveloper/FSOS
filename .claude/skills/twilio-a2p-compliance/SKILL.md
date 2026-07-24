---
name: twilio-a2p-compliance
description: Work on FSOS's outbound SMS/messaging path with A2P 10DLC and TCPA compliance enforced. Use this whenever the task touches Twilio, SMS sending or inbound, the communications dispatcher, the compliance gate, consent, quiet hours, DNC, STOP/HELP keyword handling, message templates, delegated on-behalf-of sends, first-contact identity disclosure, frequency caps, conversation-collision pausing, AI auto-send authority, data-confidence checks, campaign simulation, or A2P 10DLC brand/campaign registration. Reach for it even when the user just says "send a text", "why was this SMS blocked", "wire up the STOP keyword", or "add an appointment reminder text" — so consent, quiet hours, DNC, the securities firewall, and the AI red-line are all checked before anything sends.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: communications
  guardrails: "2.2, 2.3, 7"
---

# Twilio / A2P 10DLC Compliance

Owns the outbound messaging path in FSOS. The whole point of this skill is that **no automated message reaches a person until it has passed the gate** — a blocked send is logged and escalated to the human FSA, never silently dropped (CLAUDE.md §7).

## The gate is the law

There is exactly **one** gate — the pure decision core `evaluateGate` in `src/lib/comms/gate.ts`. It has grown from the original 7 checks to the ordered sequence below as the native communications platform was built (Slices 1–6). Every automated SMS/email passes these checks **in order, blocking on the first failure**. Extend this one gate — never add a second engine, and never bypass it.

**Current order (first failing step wins):**

1. **ownership** — authoritative ownership (agency / agency-owner / represented-agent / actual sender) must resolve; unresolved → assignment-review queue. *Escalates.*
2. **consent** — valid channel consent on file. *Escalates.*
3. **quiet_hours** — recipient-local 9:00–20:00 TCPA floor (non-negotiable). *Escalates.*
4. **business_hours** — operator's configured hours of operation (can only tighten the floor). *Operational deferral — does NOT escalate* (held for next in-hours cycle).
5. **delegation** — the FSA↔agency-owner on-behalf-of authority is ACTIVE and in-scope. *Escalates.*
6. **dnc** — not on internal/external do-not-contact. *Escalates.*
7. **approved_template** — approved template or approved AI policy. *Escalates.*
8. **recommendation** — no individualized product/investment/replacement/allocation call-to-action (§2.2 red line). *Escalates.*
9. **is_security** — record/recipient not securities-flagged (§2.1). *Escalates → FFS-supervised handling.*
10. **data_confidence** — a *specific* claim (deadline, ownership, lapse/age/appointment status) rests on verified, non-conflicting, above-threshold data (§13). *Escalates → verification task; never sent on a guess.*
11. **other_rule** — any FFS/Farmers/carrier/state/federal rule block. *Escalates.*
12. **frequency** — within the recipient's configured rate caps (§9). *Operational deferral — does NOT escalate.*
13. **collision** — a higher-priority campaign or active conversation is underway, so this promotional send pauses (§10). *Operational deferral — does NOT escalate.*

**Two invariants to preserve when you touch the gate:**

- **Escalating compliance blocks run BEFORE the operational deferrals.** `frequency` and `collision` are checked LAST (steps 12–13) precisely so a DNC / delegation / securities / recommendation / data-confidence failure surfaces and escalates first and can never be *masked* by a non-escalating deferral. If you add a compliance block, put it ahead of frequency/collision; if you add an operational deferral, put it at the end with `escalate = false`.
- **New gate inputs are default-permissive for backward compatibility.** Every input added after the original 7 (`ownershipResolved`, `delegationValid`, `withinBusinessHours`, `withinFrequencyCaps`, `collisionPaused`, `dataConfidenceOk`) defaults so that a caller that doesn't set it gets the pre-existing behavior. A new dimension is *opt-in per call site*, so existing sends are never silently changed. `blocked(step, escalate = true, reason?)` builds the result; pass `escalate = false` only for a true operational deferral.

## The build pattern for a new gate dimension (pure core → DB resolver → opt-in wiring)

Every Slice-1–6 dimension follows the same three-layer shape. Reuse it; do not invent a parallel path:

1. **Pure decision core** — a clock-free, DB-free `evaluate*` function in its own `src/lib/comms/*.ts` (`delegation.ts`, `identity.ts`, `purpose.ts`, `frequency.ts`, `conversation-mode.ts`, `ai-authority.ts`, `evaluations.ts`, `data-confidence.ts`, `simulation-core.ts`). It is offline-unit-tested by compiling with `tsc` and `require`-ing the JS — no DB, no network.
2. **DB resolver** — a thin function that reads the config/state rows and produces the pure core's inputs (`ownership.ts`, `identity-resolver.ts`, `policy-resolver.ts`). Fail-closed on ambiguity; deterministic ordered queries; prefer the scoped row then fall back to the channel-wide default.
3. **Opt-in wiring in `send.ts`** — `sendThroughGate` computes the fresh gate inputs at send time and passes them via a `ctx.*` field (`ctx.ownership`, `ctx.delegation`, `ctx.identity`, `ctx.purpose`, `ctx.dataConfidence`, `ctx.aiMessageClass`). A call site opts in by supplying the ctx; unwired call sites keep gate-only behavior.

## The AI cannot auto-send what it can't classify as low-risk (§11/§12)

`ai-authority.ts` (`evaluateAiAuthority`) maps a **code-assigned** message class → `auto_send | draft_only | blocked`: the low-risk classes auto-send, advisory/pricing/needs-analysis/replacement/underwriting/complaint/sensitive/financial/case-affecting classes are **draft-only**, securities is **blocked**, and an **unknown class fails safe to draft-only**. A prompt cannot make the AI auto-send securities or advice — the decision is a deterministic function of the class, not the model output. `evaluations.ts` (`evaluateOutboundMessage`) collects *all* §12 failures plus the authority into `mayAutoSend`; `!mayAutoSend` records an `ai_draft` `agent_action`, marks the message blocked (`blocked_step='ai_authority'`), and escalates to the licensed FSA. An auto-send-class message still passes the full gate afterwards.

## Simulation is required before a campaign activates (§14)

`simulation.ts` `simulateCampaign` is a **read-only** dry-run: it resolves the audience and runs the *same* pure `evaluateGate` per contact, renders bodies, and **never touches `sendThroughGate`/`dispatch`** — so "never calls Twilio or Resend" is structural, not a flag. `simulation-core.ts` `simulationSatisfiesActivation` is a pure gate on `comm_campaigns.simulated_at`; the activate API returns **422 `simulation_required`** unless a recent simulation is on record. When you add a new gate dimension, it lights up in the preview automatically because the simulator shares the gate.

## Authoritative sources — read, don't duplicate

- **The gate (pure core):** `src/lib/comms/gate.ts`. **Dispatcher (wires consent/DNC/audit/escalation/senders):** `src/lib/comms/dispatcher.ts`. **Send entry:** `src/lib/comms/send.ts`.
- **Gate dimensions (pure cores + resolvers):** `delegation.ts` + `ownership.ts` (on-behalf-of authority + owner resolution), `identity.ts` + `identity-resolver.ts` (first-contact disclosure), `purpose.ts` + `frequency.ts` + `policy-resolver.ts` (purpose classification, rate caps, collision, per-purpose consent), `conversation-mode.ts` (reply pauses drips), `ai-authority.ts` + `evaluations.ts` (AI auto-send authority), `data-confidence.ts` (§13), `simulation.ts` + `simulation-core.ts` (§14).
- **Twilio specifics:** `src/lib/comms/twilio.ts` (inbound signature verification), `inbound.ts`, `keywords.ts` (STOP/HELP), `hours.ts` (quiet hours). Email: `resend.ts`.
- **Guardrail helpers:** `src/lib/compliance/guardrail.ts` (recommendation-language + quiet-hours). 
- **Spec/ADR:** `docs/specs/comms-ai-compliance.md`, `CLAUDE.md` §7/§2.2, ADR-013 (canonical `comm_*`), ADR-015 (delegation/sender), ADR-016 (identity disclosure), ADR-017 (purpose/frequency/collision), ADR-018 (conversation mode), ADR-019 (AI authority), ADR-020 (data confidence), ADR-021 (simulation).
- **Schema:** consents in `009_aggregate_root_core.sql`; comms in `033_comms_inbound_knowledge_campaigns.sql`; comms-native migrations `049`–`057`.
- **Tests (keep green):** `tests/guardrail.test.mjs`, `guardrail-proof.test.mjs`, `comms-two-way.test.mjs`, and the per-dimension cores `comms-delegation`, `comms-identity`, `comms-policy`, `comms-conversation`, `comms-ai-authority`, `comms-data-confidence`, `comms-simulation`.

## Consent lives on `consents`/`dnc_entries` — with a per-purpose companion

Enforced opt-outs are `consents` + `dnc_entries` (never a separate `consent_ledger`). The **channel-wide** grant keeps `consents unique(member_id, channel)` — that constraint is an `ON CONFLICT` arbiter for every STOP/START upsert, so it must stay a **full** unique constraint. The **per-purpose** axis lives in the companion table `comm_consent_purposes` with a full `unique(member_id, channel, purpose)`; `policy-resolver.ts` prefers the scoped row then falls back to channel-wide. **Hazard (learned the hard way, migration 054→055):** a *partial* unique index cannot be an `ON CONFLICT` arbiter — swapping the channel constraint for partial indexes silently breaks every STOP/START opt-out upsert. Never replace an upsert-arbiter constraint with a partial index; add a companion table instead.

## Rules specific to A2P / Twilio

1. **A2P 10DLC registration values are config defaults, not facts (§2.3).** Brand/campaign status, throughput, and carrier rules carry `is_assumption = true` and a "config default — verify" badge (archetype A10). Unconfirmed registration/integration → labeled manual/placeholder fallback, never invented API behavior.
2. **Verify inbound webhooks.** Twilio inbound is signature-verified (`twilio.ts`); production rejects an unverifiable request. Never weaken this to fail-open in production.
3. **Honor STOP/HELP immediately.** Inbound opt-out flows through `keywords.ts` and updates consent/DNC before any further send. Opt-out is instant and irreversible without re-consent. A genuine reply (past STOP/START, excluding bare HELP) also pauses that contact's promotional drips (`conversation-mode.ts` / `inbound.ts`) so no "haven't heard back" follow-up fires after engagement.
4. **Securities-flagged messages never auto-send (§2.1/§2.2).** `is_security = true` is a hard gate (step 9) routing to human/FFS handling.
5. **The AI may not recommend (§2.2).** Green-zone only: identify, educate, invite, schedule, remind, follow up. Individualized product/investment/replacement/allocation language is hard-blocked and escalated (gate step 8 + AI authority matrix).

## Working here

- API routes keep `export const dynamic = 'force-dynamic'` / `export const runtime = 'nodejs'`, use `getDb()`, validate with Zod.
- Every send attempt (sent, blocked, escalated) writes to the append-only `audit_log` and the comms/compliance event log — blocked is never a no-op. The dispatcher already audits a gate block; a caller should not double-audit.

## When NOT to use this skill

- Campaign audience building / CRM sequencing / enrollment lifecycle with no send-path compliance question → **fsos-crm-workflows**.
- Broad RLS/guardrail auditing → **fsos-security-audit**.

## Validate before claiming done

- `npm run build` clean; `npm test` (includes `guardrail`, `guardrail-proof`, `comms-two-way`, and the comms-native cores) green; `npm run test:rls` for any migration.
- Add/adjust a gate test for any new block reason; never delete or weaken a guardrail test to make it pass (CLAUDE.md §1.5).
