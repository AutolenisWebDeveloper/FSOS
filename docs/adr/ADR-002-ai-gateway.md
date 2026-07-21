# ADR-002 — Model-Agnostic AI Gateway

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS uses AI for FNA/educational drafting, triage, follow-up, and other green-zone tasks in a FINRA-regulated environment. Provider APIs change, pricing shifts, and models are deprecated. Direct provider SDK calls scattered across routes and components would couple business logic to a vendor, make auditing and cost tracking impossible, and let ungoverned AI output reach clients.

## Decision
All AI access goes through a single **model-agnostic gateway** (Claude-first; OpenAI + Gemini as configured fallbacks). No provider SDK is called directly from a route or component. The gateway owns model selection/fallback, prompt versioning, structured-output validation (Zod), retries/timeouts/idempotency, cost and token accounting, confidence handling, and audit logging. Every run is recorded in `agent_runs` (model, prompt version, tokens, cost, confidence); every action in `agent_actions`.

## Rationale
- **Provider independence:** swap or fall back between models via config, not code changes.
- **Governance in one place:** guardrails, securities firewall, and validation can't be bypassed by a stray call site.
- **Auditability & cost control:** uniform logging of model, prompt version, tokens, and cost; a global kill switch halts spend.
- **Reproducibility:** prompt versioning ties every output to a known prompt.

## Alternatives Considered
- **Direct provider SDK calls** — rejected: vendor lock-in, no central governance, inconsistent logging, guardrail bypass risk.
- **Third-party orchestration platform** — rejected: adds an external compliance-perimeter dependency and reduces control over data handling in a regulated context.

## Consequences
**Positive**
- One choke point for compliance, cost, and observability.
- Painless model migration and fallback.

**Negative / trade-offs**
- The gateway is a critical path and must itself be reliable and well-tested.
- Slight indirection cost versus a direct call.

## Related Documents
- CLAUDE.md §3, §11, §11.1
- docs/adr/ADR-008-ai-governance.md, docs/adr/ADR-003-communications-dispatcher.md
