# ADR-010 — Data Ownership & Row-Level Security

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS holds regulated client and agency PII across six portals with different roles and scopes (ADR-005). Access must be provable and least-privilege, PII must be protected at rest, and every mutation must be attributable and tamper-evident for FINRA/Reg S-P auditability. Application-layer checks alone are insufficient — a query bug must not be able to leak data.

## Decision
Data ownership and access are enforced in the database with **Postgres Row-Level Security**, layered with application-level authorization.
- Every table holding client/agency data carries an **owner/tenant key**; RLS policies key access to the authenticated user's **role + scope**, derived from the session (ADR-006).
- **PII at rest** uses Supabase defaults plus `pgcrypto` column encryption for sensitive fields such as DOB.
- Every create/update/delete writes to an **append-only `audit_log`** via a DB role that cannot UPDATE/DELETE the log (tamper-evident).
- Controls are layered — DB constraints + RLS + Zod validation + service-layer enforcement — never a single point.
- Migrations are forward-only and reviewed for RLS coverage, indexing, N+1, locking, transaction scope, backward compatibility, and rollback risk.

## Rationale
- RLS makes tenant/owner isolation provable at the data layer, independent of client or route bugs.
- Append-only audit + attribution satisfies regulatory reproducibility (who/what/when/which record/automated-vs-human).
- Layered controls mean no single failure exposes data.

## Alternatives Considered
- **Application-only authorization** — rejected: one query bug leaks data; not provable at the data layer.
- **No column encryption for PII** — rejected: insufficient for the sensitivity of DOB/financial profile data.
- **Mutable audit log** — rejected: not tamper-evident; fails audit expectations.

## Consequences
**Positive**
- Provable least-privilege isolation; tamper-evident audit; defense in depth.

**Negative / trade-offs**
- RLS policies and audit triggers must be authored and **tested per table**; encrypted columns add query considerations.

## Related Documents
- CLAUDE.md §10, §13.6, §13.7, §13.9
- docs/data-guardrails.md; docs/adr/ADR-005-portal-architecture.md, ADR-006-authentication-architecture.md
