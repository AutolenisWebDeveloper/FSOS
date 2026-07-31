# `fsos-security-audit` — Route → Workspace Matrix (Slice 1)

**Subject under audit:** `docs/redesign/route-workspace-matrix.md` — the Advisor OS navigation +
layout redesign (Workspace Registry, workspace sidebar, breadcrumbs, portal-scoped back control,
⌘K palette).

**Scope of the change:** a **navigation + layout layer only.** No route URL changes. No route-group
changes. No middleware `matcher` change. No schema change. No API contract change. No change to
`PORTAL_RULES`, `evaluateAccess`, `requireRole`, or `requireApiRole`.

**Verdict:** **PASS — no unresolved RBAC / route-group ambiguity. Implementation of Slices 2–4 may
proceed.** One pre-existing MEDIUM is recorded (§5); it is **not introduced by this change** and is
out of scope for a navigation layer.

---

## 1. Method

Audited against the live checkout on `claude/fsos-premium-fintech-redesign-e4dhgf` (= `main`
`3a0e209`). Read, not assumed:

- `src/lib/auth/rbac.ts` — `PORTAL_RULES`, `portalOf`, `isPublicPath`, `evaluateAccess`.
- `src/middleware.ts` — coarse portal gate + `matcher`.
- `src/lib/auth/session.ts` — `requireRole`, `assertAgencyScope`, `assertHouseholdScope`.
- `src/lib/auth/api.ts` — `requireApiRole`, `requirePermission`, `hasSecuritiesScope`.
- All six route-group `layout.tsx` guard calls.
- `src/app/api/app/search/route.ts` — the highest-risk new-UI data path (⌘K palette source).

---

## 2. The load-bearing invariant

**FSOS authorization is a pure function of the URL prefix.** `portalOf(path)` maps a path to
exactly one portal by prefix; `PORTAL_RULES[portal]` gives the allowed roles; `evaluateAccess`
(pure) returns allow / redirect / forbid. This same decision is enforced three times
(defense-in-depth):

1. `middleware.ts` — every non-public, non-API request.
2. `<group>/layout.tsx` → `requireRole(<portal>, …)` — verified to match its own portal for all six
   groups (fsa→fsa, admin→admin, compliance→compliance, partner→partner, client→client, super→super).
3. `api/**/route.ts` → `requireApiRole(<portal>)`.

**There is no per-page ACL and no role attached to any nav item.** A nav item cannot grant access;
only the URL prefix can. Therefore a layer that adds **no new URL and no new route group** is
incapable of widening access — every workspace is a re-grouping of links the session could already
reach. This is the entire basis of the PASS.

---

## 3. Findings against the matrix

| # | Check | Result |
|---|---|---|
| 3.1 | Does any workspace introduce a new URL? | **No.** Every route in the matrix already exists in `src/app` (matrix invariant §0.1.3). |
| 3.2 | Does any workspace move a route across a portal boundary? | **No.** Every workspace's routes share one `portalOf` (invariant §0.1.2). The FSA `/app/compliance/*` lens (workspace 21) stays `portalOf → fsa`; it is not merged with the `(compliance)` group at `/compliance/*`. |
| 3.3 | Could the global back-nav leak access? | **Prevented by design (§7 of the matrix).** Back-nav target is the workspace's own portal home, asserted `portalOf(backTarget) === ws.portal`. No `/app` link renders on a partner/client page. |
| 3.4 | Does the ⌘K palette expose data across a boundary? | **No.** It links only to routes the current session can reach and sources results from `/api/app/search`, which is gated `requireApiRole('fsa')` and searches only non-securities entities (households, members, agencies, referrals). A client/partner session receives 403 (§5). |
| 3.5 | Does the change touch the middleware `matcher`? | **No.** The matcher is unchanged; API routes and static assets remain excluded exactly as today. |
| 3.6 | Does the registry let a declared segment drift from the enforced one? | **No** once the Slice-4 invariant test lands: `ws.portal === portalOf(ws.homeRoute)` fails the build on drift (§4). |

---

## 4. Required guardrail tests (land in Slice 4, before the reference workspace merges)

These convert the invariants above into enforced tests. They may not be weakened (CLAUDE.md §13.13):

1. **`registry-portal-consistency`** — for every workspace: `ws.portal === portalOf(ws.homeRoute)`,
   and `portalOf(r) === ws.portal` for every member route `r`.
2. **`registry-routes-exist`** — every registry route resolves to a real `page.tsx` under `src/app`.
3. **`registry-covers-legacy-nav`** — the union of FSA workspace routes is a superset of the current
   `(fsa)/layout.tsx` `NAV` hrefs (nothing dropped).
4. **`backnav-same-portal`** — every workspace's back-nav target satisfies `portalOf(target) === ws.portal`.

The existing `auth-matrix` / fail-closed guard tests remain unchanged and untouched by this work.

---

## 5. Pre-existing finding (NOT introduced here) — MEDIUM, informational

**`src/app/api/app/search/route.ts`** is correctly gated `requireApiRole('fsa')` and searches only
non-securities entities, so the securities firewall (§4.1) holds and the ⌘K palette is safe today.
However, its comment states *"per-book scoping is enforced by RLS on the underlying tables"* while
the query runs through `getDb()` — the **service-role** client, which **bypasses RLS by design.**

- **Impact today: none.** FSOS is a single-FSA book; all three FSA roles are entitled to the entire
  book, and the route never returns a securities-substantive row. Nothing leaks.
- **Latent risk:** the comment would *license* a future engineer to reuse this pattern for a
  partner- or client-facing search, where the absent RLS enforcement **would** leak cross-tenant.
- **Disposition:** **left unchanged.** It is a pre-existing condition on `main`, unrelated to a
  navigation layer, and outside Slice 1–4 scope. Recorded here so the fan-out (or a dedicated
  hardening slice) addresses the comment/behavior mismatch — either by enforcing an explicit
  `agency`/`household` scope filter in the query or by correcting the comment to say the gate, not
  RLS, is what scopes it.

No other route-group or RBAC ambiguity surfaced. Sign-off stands: **PASS.**
