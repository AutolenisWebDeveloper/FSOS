# ADR-020 — Data Confidence & Source Verification (No Specific Claim on Unverified Data)

**Status:** Accepted
**Date:** 2026-07-24
**Owner:** FSOS Engineering
**Related:** ADR-003 (dispatcher), ADR-004 (securities firewall), ADR-017 (policy engine); CLAUDE.md §4.3, §13; master build instruction §13 (§14 simulation is the immediate follow-up).

## Context

Master build instruction §13 requires that FSOS **never send a message making a SPECIFIC claim** — a term-conversion deadline, product ownership, lapse/age status, household relationship, agency ownership, appointment status — when the underlying data is **unverified, conflicting, stale, or incomplete**. When confidence is insufficient the contact must be **excluded** and a **verification task** raised, with the decision preserved in audit. A generic educational invitation ("would you be open to a review?") makes no specific claim and needs no verified data.

The gate already blocked recommendation language and securities, but had no notion of **claim-field confidence**.

## Decision

**A pure data-confidence decision, enforced as a gate step, with a verification-task recovery path — the established pure-core + opt-in-wiring pattern (ADR-015–019).**

1. **`data-confidence.ts` (pure).** `evaluateDataConfidence({ makesSpecificClaims, claims, minConfidence }) → { allowed, reason, unverified[] }`. A message with no specific claims always passes. A message with specific claims passes only when **every** dependent field is *sufficient* — verified, not conflicting, and (if only scored) at/above the confidence threshold (default 0.8). It returns **all** insufficient fields for the verification task.

2. **`gate.ts` — step `data_confidence`.** Default-permissive (`dataConfidenceOk` defaults true); a false **hard-blocks + escalates**. Placed after `is_security` and before `other_rule` — an escalating compliance block that precedes the operational deferrals (frequency/collision), so an unverified-claim send surfaces and excludes rather than being silently deferred.

3. **`send.ts` (opt-in via `ctx.dataConfidence`).** When the caller marks a message as making specific claims and supplies the dependent fields, the decision feeds the gate. On a `data_confidence` block the send is excluded and a **verification task** is created on `work_tasks` (the dispatcher already writes the compliance-block audit). Absent `ctx.dataConfidence`, behavior is unchanged — generic invitations are never constrained.

No schema change: claim-field verification metadata is supplied by the caller (from the domain records it is already reading), and the verification task reuses `work_tasks`.

## Rationale

- **Claims, not fields, are the risk.** The check keys on whether the *message* asserts a specific claim, so generic outreach is never blocked while a deadline/ownership claim requires verified data — matching §13 exactly.
- **Fail-safe + recoverable.** Insufficient data excludes the contact (never a guess) and raises an actionable verification task, rather than silently dropping or sending.
- **One gate, pure core.** Enforced in the single dispatcher gate (ADR-003); the decision is pure and exhaustively tested; the wiring is a thin opt-in adapter.
- **No invented facts (§4.3).** This operationalizes "never present unverified Farmers/policy data as a claim" at the send boundary.

## Alternatives Considered

- **Add verified/confidence columns to every domain table now** — deferred: §13 lists many fields across policies/households/appointments; adding a confidence axis everywhere is a broad schema change. The gate primitive + caller-supplied fields deliver the enforcement now; per-table confidence metadata can follow where a specific claim path needs it.
- **Block all sends lacking verified data** — rejected: generic invitations legitimately need no verified data; blocking them would halt outreach and contradicts §13's "specific claim" scoping.

## Consequences

**Positive**
- FSOS cannot send a specific claim on unverified/conflicting data; such contacts are excluded with a verification task and an audit trail.
- Deterministic, tested, opt-in — no behavior change for existing generic sends.

**Negative / trade-offs**
- Enforcement depends on callers correctly marking `makesSpecificClaims` and supplying the fields; the campaign-library claim paths (term-conversion, cross-sell) are the adoption follow-up.
- **§14 simulation mode** (a required-before-activation dry-run preview) is the immediate next slice; this ADR covers §13 only.

## Related Documents

- CLAUDE.md §4.3, §13; master build instruction §13, §14
- ADR-003, ADR-004, ADR-017
- `src/lib/comms/data-confidence.ts`, `gate.ts`, `send.ts`
- Tests: `tests/comms-data-confidence.test.mjs`
