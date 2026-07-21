# ADR-006 — Authentication Architecture

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS holds client PII, DOBs, financial profiles, and policy data. A prior state left it deployable to a public URL with no authentication — a Reg S-P / regulatory incident. Auth is the top P0 blocker. It must integrate with the shared six-portal permission model and RLS.

## Decision
Authentication uses **Supabase Auth**. A session guard protects every non-public route (only the P-0 public surface — agency referral `/[slug]`, `/upload/[slug]`, `/forms/[formId]` — is guard-free). The session establishes the user's role and scope, which drive both application-level authorization and Postgres **Row-Level Security**; authorization is enforced server-side on every request. Auth screens use the branded `A13 AuthShell`. Session timeout preserves the intended destination and returns the user there after re-auth. Auth UX (login, forgot-password, MFA, locked-account, session-timeout) follows `DESIGN.md`.

## Rationale
- Supabase Auth is native to the chosen data platform; sessions map cleanly to RLS policies.
- Server-side enforcement + RLS gives layered defense; a client bug can't leak data the DB won't return.
- Centralizing auth in the shared backend keeps all six portals consistent.

## Alternatives Considered
- **Custom auth** — rejected: needless risk in a regulated system; reinvents session/MFA/reset securely.
- **Frontend-only route protection** — rejected: never sufficient; RLS + server checks are required.
- **Third-party IdP now** — deferred: revisit if SSO/enterprise needs emerge; not required for the single-operator model today.

## Consequences
**Positive**
- Closes the regulatory blocker; PII protected by session + RLS.
- Uniform auth across portals.

**Negative / trade-offs**
- RLS policies must be authored and tested per table; auth is on the critical path for every non-public feature.

## Related Documents
- CLAUDE.md §3.1, §9, §20
- docs/middleware-auth.md, docs/adr/ADR-005-portal-architecture.md, docs/adr/ADR-010-data-ownership-and-rls.md
