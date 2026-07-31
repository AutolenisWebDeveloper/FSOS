# `fsos-security-audit` — Advisor OS shell + Workspace Registry (structural milestone)

**Subject:** the completed structural redesign — the workspace shell (`WorkspaceShell` /
`WorkspaceNav` / `CommandPalette` / `Breadcrumbs`) and the Workspace Registry, now adopted by **all
six portals** (PRs #193/#194/#195, merged).

**Question this audit answers (owner directive):** does every registry entry's permission exactly
mirror its route's RBAC segment, and did any portal boundary shift in the migration?

**Verdict: PASS.** The redesign changed **zero authorization code**. Nav is a pure presentation
layer over the unchanged URL-prefix authorization. One pre-existing MEDIUM (`api/app/search`) is
carried forward and **fixed in the companion commit**, not left open.

---

## 1. Method

- **Byte-diff of the authorization spine** against the pre-redesign base (`3a0e209`).
- **Guard inspection** of all six migrated portal layouts.
- **Registry invariants** — now 8 groups, extended to enforce all-portal legacy coverage.
- **Proof suite** — `npm test` (auth-matrix, guardrail, fail-closed) + `npm run test:rls`.

---

## 2. The decisive finding — the auth spine is unchanged

```
git diff --stat 3a0e209 HEAD -- src/middleware.ts src/lib/auth/rbac.ts \
    src/lib/auth/session.ts src/lib/auth/api.ts
→ (empty — zero lines changed)
```

`PORTAL_RULES`, `evaluateAccess`, `portalOf`, `isPublicPath`, `requireRole`, `requireApiRole`, and
the middleware `matcher` are **byte-identical** to before the redesign. Because authorization is a
pure function of the URL prefix (`portalOf(path)`), and no URL, route group, or rule changed, **no
registry entry can grant access its route did not already grant, and no portal boundary can have
shifted.** This is the strongest available proof and it is mechanical, not a judgement call.

Every migrated layout still guards with its own portal:

| Portal | Guard (verified in the merged code) |
|---|---|
| `(fsa)` | `requireRole('fsa', …)` |
| `(admin)` | `requireRole('admin', …)` |
| `(super)` | `requireRole('super', …)` |
| `(compliance)` | `requireRole('compliance', …)` |
| `(partner)` | `requireRole('partner', …)` |
| `(client)` | `requireRole('client', …)` |

---

## 3. Registry ↔ RBAC segment consistency (test-enforced)

`tests/workspace-registry.test.mjs` — **8 invariant groups, all green**:

1. `portalOf(workspace.home) === workspace.portal` for every workspace.
2. Every `match` prefix and every sub-nav `href` resolves to the workspace's own portal.
3. Every home/nav href resolves to a real `page.tsx` (route-group aware).
4. **(new)** Every migrated portal's **legacy sidebar** destination is covered by a dedicated
   in-portal workspace prefix, and `activeWorkspace(href).portal === portal` — proving the fan-out
   dropped no destination and shifted no boundary, for **all six** portals (not just FSA).
5. `PORTAL_HOME[portal]` routes back to that same portal (no cross-portal back-nav).

These invariants may not be weakened (CLAUDE.md §13.13). A build-time guard (`icons.tsx`
`assertPortal`) additionally stops `WorkspacePortal` from drifting out of `rbac.Portal`.

---

## 4. Presentation-only gating is not authorization (`hiddenHrefs`)

The partner comp-disclosure gate hides `/partner/commissions` from the sidebar + palette via
`hiddenHrefs`. This is **presentation only** — the route retains its own guard and **still 403s on
a deep link**. Hidden ≠ unauthorized; the audit confirms no gate moved from the server to the UI.

---

## 5. Guardrails (§2) — untouched by a nav layer

- **Securities firewall (§2.1):** the shell renders no securities-substantive data. The command
  palette is **registry-navigation only** — it queries no data and adds no data path (so it opens
  no new RLS/firewall surface). The FSA "Compliance" workspace links to the existing
  `/app/compliance/*` pages unchanged.
- **AI red-line (§2.2)** and **no-invented-data / assumption badge (§2.3):** no comms or AI
  dispatch path was touched; the purple firewall marker and gold assumption badge continue to
  render wherever their rows appear.

---

## 6. Carried-forward finding — `api/app/search` (MEDIUM), fixed in the companion commit

`src/app/api/app/search/route.ts` is correctly gated `requireApiRole('fsa')` and returns only
non-securities entities, so the firewall holds. Its comment claimed *"per-book scoping is enforced
by RLS"* while querying via the service-role `getDb()` (which bypasses RLS). Harmless today
(single-FSA book), but the comment would mislead a future partner/client reuse. **Fixed in the
companion commit** — the comment is corrected to state the true control (the portal gate scopes it,
not RLS), and an explicit non-deleted / entity-scope note is added. (Note: the redesign's command
palette does **not** call this route; entity search remains the dedicated `/app/search` page.)

---

## 7. Definition of Done

- Auth spine byte-unchanged; every portal guard intact. ✅
- Registry ↔ RBAC consistency test-enforced across all six portals (8 invariant groups). ✅
- No fail-open path introduced; `hiddenHrefs` is presentation-only. ✅
- Proof suite green (`npm test`; `npm run test:rls`). ✅ (see PR verification table)
- The one pre-existing MEDIUM is fixed, not deferred. ✅

**Sign-off: PASS.**
