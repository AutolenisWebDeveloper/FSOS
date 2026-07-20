---
name: twilio-a2p-compliance
description: Work on FSOS's outbound SMS/messaging path with A2P 10DLC and TCPA compliance enforced. Use this whenever the task touches Twilio, SMS sending or inbound, the communications dispatcher, the 7-step compliance gate, consent, quiet hours, DNC, STOP/HELP keyword handling, message templates, or A2P 10DLC brand/campaign registration. Reach for it even when the user just says "send a text", "why was this SMS blocked", "wire up the STOP keyword", or "add an appointment reminder text" — so consent, quiet hours, DNC, the securities firewall, and the AI red-line are all checked before anything sends.
license: Proprietary — internal FSOS use only.
metadata:
  project: FSOS
  subsystem: communications
  guardrails: "2.2, 2.3, 7"
---

# Twilio / A2P 10DLC Compliance

Owns the outbound messaging path in FSOS. The whole point of this skill is that **no automated message reaches a person until it has passed the gate** — a blocked send is logged and escalated to the human FSA, never silently dropped (CLAUDE.md §7).

## The 7-step gate is the law

Before ANY automated SMS/email sends, the dispatcher checks, in order, and blocks on the first failure:

1. valid consent on that channel, 2. within permitted quiet hours (recipient-local; 9am–8pm conservative TCPA floor), 3. not on internal or applicable external DNC, 4. approved template or approved AI policy, 5. not an individualized securities recommendation (§2.2 red line), 6. not `is_security`-flagged, 7. not otherwise blocked by FFS/Farmers/carrier/state/federal rule.

This lives as pure, unit-testable logic — extend that, do not bypass it.

## Authoritative sources — read, don't duplicate

- **The gate (pure decision core):** `src/lib/comms/gate.ts`. **Dispatcher (wires consent/DNC/audit/escalation/senders):** `src/lib/comms/dispatcher.ts`.
- **Twilio specifics:** `src/lib/comms/twilio.ts` (inbound signature verification), `src/lib/comms/send.ts`, `src/lib/comms/inbound.ts`, `src/lib/comms/keywords.ts` (STOP/HELP), `src/lib/comms/hours.ts` (quiet hours).
- **Guardrail helpers:** `src/lib/compliance/guardrail.ts` (recommendation-language + quiet-hours checks). Email counterpart: `src/lib/comms/resend.ts`.
- **Spec:** `docs/specs/comms-ai-compliance.md`, `CLAUDE.md` §7 and §2.2. Schema: `supabase/migrations/033_comms_inbound_knowledge_campaigns.sql`, `supabase/migrations/012_p1_reviews_comms_commission.sql`, `supabase/migrations/009_aggregate_root_core.sql` (consents).
- **Tests (keep green):** `tests/guardrail.test.mjs`, `tests/guardrail-proof.test.mjs`, `tests/comms-two-way.test.mjs`.

## Rules specific to A2P / Twilio

1. **A2P 10DLC registration values are config defaults, not facts (§2.3).** Brand/campaign registration status, throughput limits, and carrier rules are not something to hardcode as verified truth — carry them as editable config with `is_assumption = true` and a "config default — verify" badge (archetype A10). Where a real registration/integration is unconfirmed, implement the labeled manual/placeholder fallback rather than inventing API behavior.
2. **Verify inbound webhooks.** Twilio inbound is signature-verified (`src/lib/comms/twilio.ts`); in production an unverifiable request is rejected. Never weaken this to "fail open" in production.
3. **Honor STOP/HELP immediately.** Inbound opt-out flows through `keywords.ts` and updates consent/DNC before any further send. Opt-out is instant and irreversible without re-consent.
4. **Securities-flagged messages never auto-send (§2.1/§2.2).** `is_security = true` is a hard gate (step 6) routing to human/FFS handling.
5. **The AI may not recommend (§2.2).** Green-zone only: identify, educate, invite, schedule, remind, follow up. Any individualized product/investment/replacement/allocation language is hard-blocked and escalated.

## Working here

- API routes keep `export const dynamic = 'force-dynamic'` / `export const runtime = 'nodejs'`, use `getDb()`, validate with Zod.
- Every send attempt (sent, blocked, escalated) writes to the append-only `audit_log` and the comms/compliance event log — blocked is never a no-op.

## When NOT to use this skill

- Campaign audience building / CRM sequencing with no send-path compliance question → **fsos-crm-workflows**.
- Broad RLS/guardrail auditing → **fsos-security-audit**.

## Validate before claiming done

- `npm run build` clean; `npm test` (includes `guardrail`, `guardrail-proof`, `comms-two-way`) green.
- Add/adjust a gate test for any new block reason; never delete or weaken a guardrail test to make it pass (CLAUDE.md §1.5).
