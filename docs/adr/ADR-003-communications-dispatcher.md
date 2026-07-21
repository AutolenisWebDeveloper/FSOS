# ADR-003 — Single Communications Dispatcher

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS sends outbound SMS (Twilio) and email (Resend), some AI-drafted, in a TCPA/A2P/TRAIGA and FINRA-regulated context. If any code path could send directly, consent, quiet hours, DNC, the securities firewall, and AI guardrails could be bypassed — a regulatory incident. Compliance checks must be impossible to skip.

## Decision
Every outbound automated communication routes through **one dispatcher** that enforces, in order, blocking on first failure: (1) channel consent, (2) quiet hours (recipient-local, 9am–8pm floor), (3) DNC, (4) approved template or approved AI policy, (5) not an individualized securities recommendation, (6) not `is_security`-flagged, (7) no other FFS/Farmers/carrier/state/federal block. It applies TCPA prior-express-consent, TRAIGA AI disclosure, and A2P 10DLC requirements, logs every send/block, tracks delivery, and escalates blocked sends rather than dropping them silently.

## Rationale
- **Single choke point** makes compliance enforceable and auditable; no path can send without passing checks.
- Centralizes consent, quiet-hours, DNC, firewall, and AI-guardrail logic instead of duplicating (and diverging) it.
- Produces the TCPA defense record and delivery audit trail regulators expect.

## Alternatives Considered
- **Per-feature sending** — rejected: guaranteed drift and bypass; no uniform audit.
- **Provider-native compliance only** — rejected: providers don't know FSOS's consent ledger, securities flags, or AI policies.

## Consequences
**Positive**
- Enforceable, auditable communications compliance.
- One place to update rules as regulations change.

**Negative / trade-offs**
- The dispatcher is a critical dependency; its availability and correctness are load-bearing.
- All new messaging features must integrate with it — no shortcuts.

## Related Documents
- CLAUDE.md §12, §4.1, §4.2, §16
- docs/specs/comms-ai-compliance.md; `.claude/skills/twilio-a2p-compliance`
