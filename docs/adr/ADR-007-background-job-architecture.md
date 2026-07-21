# ADR-007 — Durable Background-Job Architecture

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS agents (triage, follow-up, cross-sell, term-conversion, reconciliation, etc.) and heavy operations (bulk sends, batch AI, large exports) must run reliably, survive human-approval pauses, and never depend on an open browser/chat session. Make.com was evaluated and removed to avoid a non-version-controlled automation layer with a compliance-perimeter gap.

## Decision
Agents and long-running work run as **durable, event-driven background jobs** on **Vercel Cron + a queue/event table** in Postgres — not open chat sessions. Jobs persist state and can suspend/resume across an approval pause. They are retry-safe, idempotent where practical, observable, auditable, recoverable, and protected from duplicate execution; they record partial progress and fail without corrupting data. Every run writes `agent_runs`; every action writes `agent_actions`. A kill switch (`/super/ai/policies`) is checked at run start. Automation is Vercel Cron + GHL-native workflows + direct webhook endpoints — no Make.com.

## Rationale
- **Durability & resumability:** work outlives sessions and survives approval gates.
- **Version-controlled & auditable:** automation lives in the repo, not an opaque external tool.
- **Idempotency + kill switch:** safe retries and a hard stop for spend/behavior.

## Alternatives Considered
- **Make.com (or similar) scenarios** — rejected: not version-controlled; compliance-perimeter gap; opaque to audit.
- **Synchronous in-request execution** — rejected: ties long work to a live connection; risks timeouts and partial writes.
- **Open chatbot session as the runtime** — rejected: not durable; can't survive pauses or restarts.

## Consequences
**Positive**
- Reliable, auditable, resumable automation under version control.
- Clean separation of long work from request handlers.

**Negative / trade-offs**
- Requires a queue/event table and cron discipline; idempotency must be designed per job.

## Related Documents
- CLAUDE.md §3, §11, §13.11, §16
- docs/adr/ADR-002-ai-gateway.md, docs/adr/ADR-003-communications-dispatcher.md
