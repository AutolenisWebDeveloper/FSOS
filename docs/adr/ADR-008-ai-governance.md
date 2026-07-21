# ADR-008 — AI Governance

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
AI is central to FSOS but operates in a FINRA-regulated context with a hard securities red line (ADR-004). Ungoverned AI could recommend products, make suitability calls, hallucinate rules/citations, send unconsented messages, or mutate business data. Governance must be enforced structurally, not by prompt hope.

## Decision
All AI is governed by binding rules enforced at the gateway (ADR-002) and dispatcher (ADR-003):
- **Green zone / red line:** AI may identify, educate, invite, schedule, remind, follow up, run approved campaigns, draft internal material, assemble data, and log. AI may never make an individualized product/policy/investment/replacement/allocation/transaction recommendation, make a suitability/best-interest determination, or issue a securities call to action.
- **Structured outputs + deterministic validation:** every AI output is Zod-validated before use; validation failure fails safe (no dispatch/write) and escalates.
- **Prompt versioning:** prompts are versioned artifacts; the version is recorded on every `agent_runs` row.
- **Confidence thresholds:** sub-threshold output routes to human review; never auto-dispatch/auto-write.
- **Retry/timeout/idempotency; cost awareness:** bounded retries with backoff, timeouts, idempotent effects, per-run token/cost logging, budget guards, kill switch.
- **Hallucination prevention:** no fabricated rule/integration/citation/product fact; ground output in supplied data and the authority-tagged corpus; unverified facts are surfaced as assumptions, not claims.
- **No autonomous mutation:** AI never directly mutates sensitive data or triggers a regulated client-facing action without validation + human approval. Every client-facing AI message passes the Compliance Guardrail.

## Rationale
- Turns compliance from aspiration into enforced control points.
- Makes AI behavior reproducible, auditable, cost-bounded, and safe to escalate.
- Protects the securities red line and the No-Invented-Farmers-Data guardrail.

## Alternatives Considered
- **Prompt-only guardrails** — rejected: non-deterministic; unsafe for regulated output.
- **Human review of everything** — rejected: doesn't scale; reserve human review for red-line, low-confidence, and client-facing dispatch.

## Consequences
**Positive**
- Safe, auditable, reproducible AI with bounded cost.
- Clear escalation and fail-safe behavior.

**Negative / trade-offs**
- More engineering per AI feature (schemas, prompt versions, confidence handling, approval states).

## Related Documents
- CLAUDE.md §4.2, §4.3, §11.1, §21
- DESIGN.md (AI UX standards); docs/adr/ADR-002-ai-gateway.md, ADR-004-securities-firewall.md
