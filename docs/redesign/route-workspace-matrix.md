# Route → Workspace Matrix (Advisor OS redesign — Slice 1)

> **Status:** VERIFIED against the live checkout on branch
> `claude/fsos-premium-fintech-redesign-e4dhgf` at `HEAD` (= `main`, commit `3a0e209`).
>
> **Sources of truth (re-derived from this checkout, not memory):**
> - Routes: `find src/app -name page.tsx -not -path '*/api/*'` → **303 page routes**
>   (203 FSA · 11 admin · 10 compliance · 12 partner · 12 client · 22 super · 33 public/root).
> - API routes: `find src/app/api -name route.ts` → **221 API route files**.
> - Authorization: `src/lib/auth/rbac.ts` (`PORTAL_RULES`, `portalOf`, `evaluateAccess`),
>   `src/middleware.ts` (coarse portal gate), `src/lib/auth/session.ts` (`requireRole` in each
>   route-group layout), `src/lib/auth/api.ts` (`requireApiRole` in the API handlers).
>
> **This matrix changes NO route URL and NO authorization.** Workspaces are a navigation +
> layout layer only. Every route keeps its URL, its route group, and its RBAC segment. The
> matrix is the input the `fsos-security-audit` sign-off (`security-audit-slice1.md`) reasons over.

---

## 0. How authorization actually works here (the invariant the redesign must not break)

FSOS authorization is a **pure function of the URL prefix.** There is no per-page ACL, no
role stored on a nav item, no data-driven route table. The chain is:

```
portalOf(path)         # rbac.ts — maps a URL prefix to exactly one portal
  → PORTAL_RULES        # rbac.ts — that portal's allowed roles + MFA level
    → evaluateAccess     # rbac.ts (pure) — allow / redirect / forbid
      ├─ middleware.ts   # coarse gate on every non-public, non-API request
      ├─ <group>/layout.tsx → requireRole(<portal>, …)   # defense-in-depth
      └─ api/**/route.ts → requireApiRole(<portal>)       # handler gate
```

Verified in this checkout — every route-group layout guards with exactly its own portal:

| Route group | URL prefix | Layout guard (verified) | RBAC segment (allowed roles) | MFA |
|---|---|---|---|---|
| `(fsa)` | `/app` | `requireRole('fsa', '/app')` | `fsa`, `licensed_staff`, `super_admin` | required |
| `(admin)` | `/admin` | `requireRole('admin', '/admin')` | `admin`, `ops`, `case_manager`, `super_admin` | required |
| `(compliance)` | `/compliance` | `requireRole('compliance', '/compliance')` | `compliance`, `supervisor`, `super_admin` | required |
| `(partner)` | `/partner` | `requireRole('partner', '/partner')` | `agency_owner` | optional |
| `(client)` | `/client` | `requireRole('client', '/client')` | `client` | optional |
| `(super)` | `/super` | `requireRole('super', '/super')` | `super_admin` | mandatory step-up |
| `(public)` + root | `/` etc. | none (allowlist in `isPublicPath`) | anonymous | none |

**Consequence for the redesign:** because access is decided by `portalOf(path)` and nothing else,
a navigation/layout layer that introduces **no new URL and no new route group** *cannot* widen
access. A workspace is a grouping of links the user could already reach. This is the load-bearing
fact the security audit signs off on.

### 0.1 Registry invariants (become tests in Slice 4)

The Workspace Registry is a static, in-repo array. Four invariants keep it from drifting from the
enforced model:

1. `ws.portal === portalOf(ws.homeRoute)` for every workspace — the declared segment can never
   diverge from the enforced one.
2. Every route a workspace lists resolves to the **same** `portalOf` as the workspace's portal —
   a workspace never links across a portal boundary.
3. Every registry route exists in `src/app` (no dangling links).
4. The union of routes across all FSA workspaces is a **superset** of today's FSA `NAV` hrefs —
   nothing in the current sidebar is dropped.

---

## 1. FSA portal (`/app`) — 203 routes → 21 workspaces

The current `(fsa)/layout.tsx` ships a **flat ~50-item sidebar** across 6 groups (Overview,
Production Operations, Book, Pipeline, Engage, Operate). The redesign consolidates those 50
top-level entries — and the 203 routes beneath them — into **21 workspaces**. Every one of the
50 current destinations survives inside a workspace; no route is removed, no URL changes.

RBAC segment for **every** row below: `fsa · licensed_staff · super_admin` (the `/app` prefix).
Back-nav target for every FSA workspace: **Executive Dashboard (`/app`)** — reachable because all
three FSA roles are entitled to `/app` (see §7 on why back-nav is portal-scoped, not global).

| # | Workspace | Home route | Member routes (representative) | Replaces sidebar group/items |
|---|---|---|---|---|
| 1 | **Executive** | `/app` | `/app/dashboards`, `/app/dashboards/[id]`, `/app/dashboards/builder`, `/app/forecasts`, `/app/executive/*` (briefing, kpis, alerts, production, performance, conversion, cross-sell), `/app/revenue`, `/app/notifications` | Overview (Dashboard, Dashboards, Forecasts, Briefing, Revenue Center, Notifications) |
| 2 | **AI Workforce** | `/app/ai/workforce` | `/app/ai`, `/app/ai/agents`, `/app/ai/agents/[id]`, `/app/ai/runs`, `/app/ai/runs/[id]`, `/app/ai/escalations`, `/app/ai/escalations/[id]`, `/app/ai/evaluations`, `/app/ai/errors`, `/app/assistant` | Overview (AI Command Center) + Operate (AI Operations, AI Escalations, AI Assistant) |
| 3 | **Financial Planning (FNA)** | `/app/fna` | `/app/fna/*` (plans, plans/[id]/{inputs,results,scenarios,report,audit}, assumptions, cash-flow, net-worth, retirement, protection, estate, education, goals, reviews, recommendations, reports, generate, formulas, timeline, audit, tax-aware, business-owner, documents) | Overview (AI FNA Command Center) |
| 4 | **Communications** | `/app/comms` | `/app/comms/*` (campaigns, campaigns/[id], campaigns/new, sequences, templates, templates/[id], library, audience, segments, sms, email, delivery, analytics, assignments, identity, suppression) | Overview (AI Communications Center) |
| 5 | **Inbox** | `/app/comms/inbox` | `/app/comms/inbox`, `/app/comms/inbox/[id]` | Engage (Inbox) — kept as its own daily-use workspace |
| 6 | **Social** | `/app/social` | `/app/social/*` (content, content/[id], content/new, calendar, queue, accounts, accounts/connect/[platform], analytics, attribution, automation, engagement, health, media) | Overview (AI Social Media Center) |
| 7 | **Cross-Sell** | `/app/cross-sell` | `/app/cross-sell/*` (household-gaps, agency-penetration, analytics, [id]), `/app/crosssell` (import) | Production Operations (Cross-Sell) + Book (Cross-Sell Import) |
| 8 | **Life Win-Back** | `/app/winback` | `/app/winback`, `/app/winback/import` | Production Operations (Life Win-Back) + Book (Win-Back Import) |
| 9 | **Life Conversion** | `/app/conversions` | `/app/conversions/*` (eligible, timeline, monitoring, analytics, import, [id]) | Production Operations (Life Conversion) + Book (Life Conversion Import) |
| 10 | **Agencies** | `/app/agencies` | `/app/agencies/*` (new, import, map, leaderboard, [id], [id]/[tab]) | Book (Agencies) |
| 11 | **Contacts** | `/app/contacts` | `/app/contacts/*` (new, import, upload, review, segments, ffs, [id]) | Book (Contacts, Import Review, Contact Upload) + Operate (FFS Contacts) |
| 12 | **Referrals** | `/app/referrals` | `/app/referrals/*` (new, analytics, [id], [id]/convert) | Book (Referrals) |
| 13 | **Households** | `/app/households` | `/app/households/*` (new, [id], [id]/[tab], [id]/assist, [id]/members/new, [id]/members/[mid]) | Book (Households) |
| 14 | **Policies** | `/app/policies` | `/app/policies/*` (new, lapse-risk, [id]) | Book (Policies) |
| 15 | **Book Imports** | `/app/book/import` | `/app/book/import` | Book (District Book) — data-onboarding home for the book |
| 16 | **Reviews** | `/app/reviews` | `/app/reviews/*` (new, due, board, calendar, types, [id], [id]/{prep,needs-map,outcome}) | Pipeline (Reviews) |
| 17 | **Opportunities** | `/app/opportunities` | `/app/opportunities/*` (new, board, [id]), `/app/opra`, `/app/opra/eligible` | Pipeline (Opportunities, OPRA Transfers) |
| 18 | **Cases** | `/app/cases` | `/app/cases/*` (new, board, requirements, service-requests, [id], [id]/checklist) | Pipeline (Cases) |
| 19 | **Commissions** | `/app/commissions` | `/app/commissions/*` (expected, pending, received, splits, statements, trails, gdc, reconciliation, discrepancies, adjustments, chargebacks, [id]) | Pipeline (Commissions) |
| 20 | **Workspace & Tools** | `/app/tasks` | `/app/tasks`, `/app/tasks/[id]`, `/app/calendar`, `/app/booking`, `/app/workflows`, `/app/workflows/builder`, `/app/workflows/[id]`, `/app/documents`, `/app/documents/*`, `/app/forms`, `/app/forms/[id]`, `/app/workshops`, `/app/workshops/*`, `/app/knowledge`, `/app/tools/calculator`, `/app/contacts/upload`, `/app/reports`, `/app/reports/*`, `/app/search` | Engage (Tasks, Calendar, Booking, Workflows, Documents, Client Forms, Workshops, Workshop Approvals, Knowledge Library, Sales Calculator) + Operate (Reports) |
| 21 | **Compliance (FSA lens)** | `/app/compliance` | `/app/compliance/*` (consent, dnc, firewall, licenses, intelligence), `/app/settings`, `/app/help` | Operate (Compliance, Compliance Intelligence, Settings, Help & Support) |

> **Note on the FSA `/app/compliance/*` subtree (workspace 21):** this is the FSA-portal
> compliance *lens* (still `portalOf → fsa`, still guarded by `requireRole('fsa', …)`). It is a
> **different surface** from the `(compliance)` route group at `/compliance/*` (§3), which is
> gated to `compliance · supervisor · super_admin`. The redesign keeps them separate; a workspace
> never bridges the two (registry invariant §0.1.2).

**Coverage check:** all 50 current sidebar hrefs appear in exactly one workspace above; the
Slice-4 invariant test (§0.1.4) enforces this mechanically.

---

## 2. Admin portal (`/admin`) — 11 routes

RBAC segment for every row: `admin · ops · case_manager · super_admin`. Back-nav target: `/admin`.
*(Migration deferred to the fan-out; listed for completeness of the matrix.)*

| Workspace | Home | Member routes |
|---|---|---|
| Admin Home | `/admin` | `/admin` |
| Users & Access | `/admin/users` | `/admin/users` |
| Cases (back-office) | `/admin/cases` | `/admin/cases` |
| Documents | `/admin/documents` | `/admin/documents`, `/admin/documents/verify` |
| Data Ops | `/admin/data/imports` | `/admin/data/imports`, `/admin/data/imports/ghl`, `/admin/data/exports`, `/admin/data/duplicates` |
| Support | `/admin/support/requests` | `/admin/support/requests` |
| Config | `/admin/config/[section]` | `/admin/config/[section]` |

---

## 3. Compliance portal (`/compliance`) — 10 routes

RBAC segment for every row: `compliance · supervisor · super_admin`. Back-nav target: `/compliance`.

| Workspace | Home | Member routes |
|---|---|---|
| Compliance Home | `/compliance` | `/compliance` |
| Supervision | `/compliance/communications` | `/compliance/communications`, `/compliance/audit`, `/compliance/incidents` |
| Consent & Firewall | `/compliance/consent` | `/compliance/consent`, `/compliance/firewall`, `/compliance/dnc`* |
| Registrations | `/compliance/licenses` | `/compliance/licenses`, `/compliance/attestations`, `/compliance/policies` |
| Legal Holds | `/compliance/legal-holds` | `/compliance/legal-holds` |

`*` `/compliance/dnc` not present as a page in this checkout under `(compliance)`; DNC lives at
`/app/compliance/dnc` (FSA lens) and is **not** cross-listed here. Removed from the row above at
implementation time if still absent — flagged so the fan-out doesn't invent a route.

---

## 4. Partner portal (`/partner`) — 12 routes

RBAC segment for every row: `agency_owner` (only). Back-nav target: `/partner`. **Not** `/app`
(see §7). Partner workspaces are intentionally few — this is a focused owner surface.

| Workspace | Home | Member routes |
|---|---|---|
| Partner Home | `/partner` | `/partner` |
| Referrals | `/partner/referrals` | `/partner/referrals`, `/partner/referrals/[id]`, `/partner/refer` |
| Production | `/partner/production` | `/partner/production`, `/partner/commissions` |
| Engagement | `/partner/messages` | `/partner/messages`, `/partner/schedule`, `/partner/tasks` |
| Resources | `/partner/materials` | `/partner/materials`, `/partner/training` |
| Settings | `/partner/settings` | `/partner/settings` |

---

## 5. Client portal (`/client`) — 12 routes

RBAC segment for every row: `client` (only). Back-nav target: `/client`. Non-securities,
non-advice content only (§4.1 firewall).

| Workspace | Home | Member routes |
|---|---|---|
| Client Home | `/client` | `/client` |
| My Case | `/client/case-status` | `/client/case-status`, `/client/documents`, `/client/documents/requests` |
| Appointments | `/client/appointments` | `/client/appointments`, `/client/schedule`, `/client/reviews` |
| Education | `/client/education` | `/client/education` |
| My Profile | `/client/profile` | `/client/profile`, `/client/preferences`, `/client/consent`, `/client/intake` |

---

## 6. Super Admin portal (`/super`) — 22 routes

RBAC segment for every row: `super_admin` (only), MFA mandatory step-up. Back-nav target: `/super`.

| Workspace | Home | Member routes |
|---|---|---|
| Super Home | `/super` | `/super` |
| AI Governance | `/super/ai/policies` | `/super/ai/policies`, `/super/ai/hours`, `/super/ai/targets`, `/super/ai/sandbox` |
| Users & Roles | `/super/users` | `/super/users`, `/super/roles`, `/super/permissions` |
| Products & Config | `/super/products` | `/super/products`, `/super/products/[id]`, `/super/product-config`, `/super/config/gdc-tiers`, `/super/config/ffs-contacts`, `/super/states` |
| Platform Ops | `/super/health` | `/super/health`, `/super/jobs`, `/super/backups`, `/super/webhooks`, `/super/workflows` |
| Integrations | `/super/integrations` | `/super/integrations` |
| Security & Audit | `/super/security` | `/super/security`, `/super/audit` |

---

## 7. Back-navigation is portal-scoped, not global (a decision the audit forced)

A single global "← Back to Executive Dashboard" pointing at `/app` would be a **latent
authorization leak in the UI layer**: `/app` is forbidden to `agency_owner` (partner) and
`client`. Rendering that link on a partner/client page would either 403 the user (broken UX) or,
worse, invite a fix that widens `/app` access.

**Rule (enforced by a Slice-4 test):** every workspace's back-nav target is its own **portal
home** — `/app` for FSA, `/admin` for admin, `/compliance` for compliance, `/partner` for
partner, `/client` for client, `/super` for super. The back-nav target must satisfy
`portalOf(backTarget) === ws.portal`. No workspace's back link ever crosses a portal boundary.

---

## 8. Public / root routes (33) — out of workspace scope

The public surface (`/`, `/about`, `/faq`, `/services`, `/schedule`, `/events`, `/workshops`,
`/[slug]`, `/upload/[slug]`, `/forms/[formId]`, legal pages, auth pages `/login`, `/login/mfa`,
`/forgot-password`, error pages `/403` `/404` `/500`) is **not** part of the authenticated
workspace model. It keeps its current layout and its auth-guard-free status
(`isPublicPath`). No workspace, no workspace sidebar, no back-to-Executive control renders here.

---

## 9. What this matrix explicitly does NOT do

- Does not add, remove, rename, or re-group any route URL.
- Does not add or remove a route group; does not touch the middleware `matcher`.
- Does not change any `requireRole` / `requireApiRole` / `PORTAL_RULES` value.
- Does not move a route from one portal to another (no route is re-parented across a boundary).
- Does not introduce a role, a permission, or a data-driven ACL.

Every change the redesign makes is additive presentation: a Workspace Registry, a workspace
sidebar component, breadcrumbs, a portal-scoped back control, and a ⌘K palette that links only to
routes the current session can already reach.
