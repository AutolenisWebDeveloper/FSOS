# ADR-005 — One Backend, Six Portals

**Status:** Accepted
**Date:** 2026-07-21
**Owner:** FSOS Engineering

## Context
FSOS serves six audiences — FSA, Admin/Back-Office, Compliance/Supervisory, Agency-Owner, Client, Super Admin — plus a public surface. These audiences share the same domain data, permission model, audit trail, and brand, but see different slices. Building six applications would fragment all of that.

## Decision
FSOS is **one Next.js backend with six portals** implemented as App Router route groups (`(fsa)`, `(admin)`, `(compliance)`, `(partner)`, `(client)`, `(super)`) plus `(public)`. All portals share one design system (`DESIGN.md`), one permission/RBAC model, one audit model, and one set of services. Authorization is enforced server-side on every non-public route via session guard + role/scope check + RLS; the frontend never enforces permissions alone; forbidden deep links return 403 via `ForbiddenState`. One `PortalShell` powers all authenticated portals.

## Rationale
- **Shared everything that must not diverge:** data, permissions, audit, brand, services.
- Role-based views over shared data are cheaper and safer than six codebases.
- A single permission model + RLS makes tenant/owner isolation provable.

## Alternatives Considered
- **Six separate apps** — rejected: duplicated auth, models, and design; drift; multiplied audit surface.
- **Client-side role gating** — rejected: never trust the client for authorization in a regulated system.

## Consequences
**Positive**
- Consistency and lower maintenance; one place to enforce authz and audit.
- Uniform UX across audiences.

**Negative / trade-offs**
- The shared backend and RBAC matrix are critical; a permissions bug has broad blast radius, so RBAC/RLS tests are mandatory.

## Related Documents
- CLAUDE.md §9, §13.8
- docs/specs/rbac-matrix.md, docs/middleware-auth.md, docs/adr/ADR-006-authentication-architecture.md, docs/adr/ADR-010-data-ownership-and-rls.md
