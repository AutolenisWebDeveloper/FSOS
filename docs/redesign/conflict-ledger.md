# CONFLICT LEDGER (redesign spec §0.5) — UI instructions superseded vs. engineering rules preserved

> **Purpose.** The redesign spec's §0.5 UI Governance clause states that the redesign
> *intentionally replaces* the existing FSOS user experience, and that CLAUDE.md / DESIGN.md are
> authoritative **only for engineering and business rules** — not for existing UI conventions
> (dashboard layouts, nav structure, component hierarchy, page layouts). This ledger records, for
> Slice 1, exactly which existing instructions are **superseded** (UI/UX presentation) and which are
> **preserved intact** (engineering, security, compliance, data, routing). It exists so nothing is
> silently resolved in the redesign's favour and nothing load-bearing is silently discarded.

**Inspection scope.** Searched the whole repo for nested contracts:

```
find . -path ./node_modules -prune -o \( -iname 'CLAUDE.md' -o -iname 'AGENTS.md' \) -print
→ ./CLAUDE.md          (repo root — the engineering contract; the only one)
```

**There is no nested `CLAUDE.md` or `AGENTS.md`** under `src/`, `docs/`, or any subdirectory. The
only authoritative documents in play are the root `CLAUDE.md` and `DESIGN.md` (638 lines, present).
No conflicting sub-contract can override the redesign at a lower level.

---

## A. SUPERSEDED — existing UI/UX conventions the redesign replaces (§0.5 authority)

These are **presentation** conventions. Per §0.5 they are *not* design requirements; the redesign
establishes the new UI baseline. Each is superseded **only** as visual/navigational structure — the
underlying routes, permissions, and data are untouched.

| # | Existing convention (source) | Superseded by (redesign) |
|---|---|---|
| S1 | Flat ~50-item grouped sidebar in `(fsa)/layout.tsx` (`NAV`, groups: Overview / Production Operations / Book / Pipeline / Engage / Operate) | 21-workspace model; the sidebar becomes a workspace switcher + per-workspace nav. |
| S2 | Single shared `PortalShell` (one dark sidebar + topbar) as the fixed shell for all portals | Workspace-aware shell: workspace sidebar, breadcrumbs, portal-scoped back control. Same `PortalShell` **extended**, not cloned (CLAUDE.md §6). |
| S3 | `MobileTabBar`-based mobile navigation as the mobile pattern | Mobile workspace drawer + persistent back; tab bar retained only where it still fits. |
| S4 | `groupNav()` first-seen-order grouping as the nav information architecture | Registry-driven workspace generation (static in-repo Workspace Registry). |
| S5 | Existing dashboard widget ordering / layout on `/app` | New Executive Dashboard composition (persisted per-user `DashboardGrid` retained so no saved layout is lost). |
| S6 | `DESIGN.md` §5.2 nav-cluster labels and any prescribed nav grouping | Workspace taxonomy in `route-workspace-matrix.md`; `DESIGN.md` to be updated in the same change that introduces the pattern (CLAUDE.md §18). |
| S7 | Any "no new feature pages while a P0 blocker is open" reading (CLAUDE.md §20) as a bar to this work | The redesign is explicitly authorized net-new UI scaffolding of a nav/layout layer; it adds **no** feature pages and no routes, so §20 is not triggered. |

---

## B. PRESERVED — engineering, security, compliance, data & routing rules (NON-negotiable)

These are authoritative and **untouched** by the redesign. The UI layer conforms to them; it does
not get to reinterpret them.

| # | Preserved rule (source) | How the redesign respects it |
|---|---|---|
| P1 | **Route groups + RBAC segments frozen** (CLAUDE.md §9, `rbac.ts`, spec §0) | No route changes group or roles; `portalOf`/`PORTAL_RULES` untouched (audit §2). |
| P2 | **Server-side authorization; frontend never enforces permissions** (CLAUDE.md §9, §13.5) | Middleware + `requireRole` + `requireApiRole` + RLS unchanged; nav filtering is cosmetic on top of them. |
| P3 | **Securities firewall** — purple marker on every `is_security` row, no substantive securities data (CLAUDE.md §4.1) | Firewall marker is a **compliance control rendered as UI**, not a style choice — retained everywhere it appears. ⌘K search returns no securities-substantive row (audit §3.4). |
| P4 | **Gold "config default — verify" assumption badge** on every `is_assumption` value (CLAUDE.md §4.3) | Retained as a compliance control; not restyled away. |
| P5 | **AI green-zone / red-line + compliance footer** (CLAUDE.md §4.2) | No AI dispatch path touched; footers and red-line gates unchanged. |
| P6 | **Communications compliance dispatcher gate** — consent, quiet hours, DNC, templates (CLAUDE.md §12) | Not touched by a nav layer. |
| P7 | **`getDb()` for all Supabase access; `dynamic='force-dynamic'` + `runtime='nodejs'` on API routes** (CLAUDE.md §3.1) | New palette API (if any) conforms; no module-level client. |
| P8 | **Thin routes → services → data; Zod at the edge** (CLAUDE.md §3.1.8, §13.4) | Registry is static config; any new endpoint parses → authorizes → calls a service. |
| P9 | **Append-only `audit_log`; RLS on client/agency tables** (CLAUDE.md §10) | Data layer untouched. |
| P10 | **Preserve recent engineering work** (spec §0): error-leak-audited files, `error.tsx`/`loading.tsx` boundaries, `env.ts`, `money.ts`, migrations 076–080 | None of these are modified by Slice 1; enumerated as off-limits for Slices 2–4. |
| P11 | **Design tokens; never hardcode a color/spacing/font** (CLAUDE.md §3.1.6, §18, DESIGN.md) | New components resolve through existing tokens; any new token is added to `DESIGN.md` in the same change. |
| P12 | **NIGO defect-prevention out of scope; Compliance Intelligence isolated** (CLAUDE.md §5) | Workspace 21 links `/app/compliance/intelligence` as-is; no case-spine cross-link introduced. |

---

## C. Net effect

- **0** engineering/security/compliance rules relaxed.
- **7** UI/UX conventions superseded (all presentation-only; routes, roles, and data unchanged).
- **12** load-bearing rules explicitly preserved, including both compliance controls that render as
  UI (purple firewall marker, gold assumption badge) — these are *not* subject to §0.5 supersession
  because they are compliance controls, not visual taste.

If any later slice appears to require relaxing a Section-B rule to achieve a Section-A visual goal,
that is a **stop-and-escalate** condition, not a silent trade-off.
