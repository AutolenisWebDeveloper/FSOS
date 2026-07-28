# ADR-028 — Governed Agent Tool-Calling

**Status:** Accepted
**Date:** 2026-07-27
**Owner:** FSOS Engineering

## Context
FSOS agents run as durable background jobs (ADR-007) whose actions are hand-written
`work(ctx)` procedures. The agent roster (`src/lib/ai/roster.ts`) declares each agent's
green-zone `tools`, but those are *labels* — the model never chooses to call a tool. As
agent behavior grows, we want the model itself to select among a bounded set of
capabilities (assemble data, classify, draft) within a run.

This is exactly the capability a third-party agent-orchestration platform
(e.g. Composio) markets. ADR-002 already **rejected** a third-party orchestration
platform: it adds an external compliance-perimeter dependency and cedes control over
data handling in a FINRA-regulated context. A `curl | bash`-installed agent framework
is also a non-version-controlled automation layer, which ADR-007 rejected for the same
reasons Make.com was removed. The forces: we need model-driven tool selection, but it
must stay inside the single AI gateway (ADR-002), the securities firewall (§4.1), the AI
red-line (§4.2), and the "no autonomous mutation" governance rule (§11.1) — with no new
external perimeter.

## Decision
Add a **governed tool-calling loop to the existing AI gateway** — not a parallel system.

- **Pure loop driver** (`src/lib/ai/tool-loop.ts`) owns the mechanics with no provider
  SDK, no DB, and no side effects of its own. It enforces, in code: (1) an **authority
  ceiling** — a tool whose `effect` is outside the caller's `allowedEffects` is rejected
  before the loop starts; (2) an **allowlist** — the model may only invoke a granted
  tool; (3) **fail-safe validation** — a tool_use whose input fails the tool's validator
  never reaches its handler; (4) a **bounded** iteration cap; (5) an **interruptible**
  per-turn guard (the kill switch, re-checked before every model turn).
- **Gateway adapter** (`runGatewayTools` in `src/lib/ai/gateway.ts`) is the only place a
  provider tool-use API is touched. It wires the driver to Claude's native tools,
  re-checks the kill switch each turn, and accounts tokens + estimated cost. Tool-calling
  requires a Claude model (no mid-loop provider fallback, which would break tool-use
  message continuity).
- **Tool authoring** (`src/lib/ai/tools.ts`) builds a model-invokable tool from a Zod
  schema — the single source of truth for both the advertised `input_schema` and the
  fail-closed runtime validator — and binds each tool to the agent's roster green-zone
  category.
- **Runner integration** (`ctx.runTools` in `src/jobs/agent-runner.ts`) grants the **v1
  authority ceiling of `read` only** (assemble / classify / draft — non-mutating,
  non-dispatching), asserts every tool is within THIS agent's roster green-zone set,
  accumulates usage/cost onto `agent_runs`, and logs every attempted tool call (ok /
  rejected / invalid / error) to `agent_actions` + `audit_log`.

Any client-facing send or data mutation stays behind the existing dispatcher gate (§12)
and human-approval controls — the model cannot dispatch or mutate through this loop in
v1. Raising the ceiling to `send` (dispatcher-gated) or `write` is a future, separately
reviewed step; the `allowedEffects` seam is already in place for it.

## Rationale
- **One choke point:** tool-calling inherits the gateway's kill switch, cost accounting,
  and audit — a stray call site can't bypass governance (ADR-002).
- **Governance enforced in code, not prompts (§19-style):** the ceiling, allowlist, and
  fail-safe validation are unit-tested pure logic, not model instructions the model could
  ignore.
- **Reuses the existing permission vocabulary (§6):** model tools bind to the roster
  green-zone set — no second permission model.
- **No autonomous mutation (§11.1):** the v1 `read`-only ceiling makes an unsafe send or
  write structurally impossible, not merely discouraged.

## Alternatives Considered
- **Third-party orchestration platform (Composio et al.)** — rejected: reaffirms ADR-002
  (external compliance perimeter, data-handling control loss) and ADR-007
  (non-version-controlled automation layer). Also blocked by the environment egress
  policy.
- **A parallel agent framework alongside the gateway** — rejected: fragments the single
  AI choke point (§6); duplicates kill switch, cost, and audit.
- **Let the model dispatch/mutate directly in v1** — rejected for now: violates §11.1;
  materially larger compliance surface. Deferred behind the `allowedEffects` seam.

## Consequences
**Positive**
- Model-driven tool selection with the same audit/cost/kill-switch guarantees as every
  other AI call.
- Governance invariants are proven by pure unit tests
  (`tests/ai-tool-loop.test.mjs`, `tests/ai-tool-authority.test.mjs`).

**Negative / trade-offs**
- Tool-calling is Claude-only in this gateway (no mid-loop fallback).
- Each new tool requires a Zod schema and a green-zone binding — deliberate friction that
  keeps the authority surface explicit.

## Related Documents
- CLAUDE.md §4.1, §4.2, §6, §11, §11.1, §13.9
- docs/adr/ADR-002-ai-gateway.md, docs/adr/ADR-007-background-job-architecture.md,
  docs/adr/ADR-008-ai-governance.md, docs/adr/ADR-003-communications-dispatcher.md
