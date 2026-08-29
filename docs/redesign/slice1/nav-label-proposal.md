# Nav-Label Proposal — Executive Dashboard Redesign (Slice 1)

> **PROPOSAL ONLY. Nothing in this document has been applied.** Per the redesign brief,
> no nav item, tab, route, label, or destination has been renamed, reordered, or removed.
> Every label and destination in the live app is **unchanged**. This is a written list for
> the owner's approval; changes will only be made after explicit sign-off, in a later slice.

## Why this exists

The mockup (image 2) shows a **single flat sidebar** with 14 destinations. The live app uses a
more capable **two-tier IA** (a 64px workspace **rail** → a contextual **sidebar** of that
workspace's sub-nav), generated from the static Workspace Registry
(`src/lib/workspaces/registry.ts`). The registry is the single source of truth and is covered by
invariant tests (`tests/workspace-registry.test.mjs`), so labels there are load-bearing.

Because the mockup's flat list and the app's workspace model are **different navigation
structures**, most "differences" are not renames — they are the same destinations grouped
differently. Below is a faithful map so you can decide whether any label should change.

## Map: mockup label → nearest existing app destination (unchanged)

| # | Mockup sidebar label | Nearest live destination (label · route) | Match | Note |
|---|---|---|---|---|
| 1 | Executive | **Executive** · `/app` | ✅ exact | Keep. |
| 2 | Client Workspace | **Households** · `/app/households` (Book) + **Contacts** · `/app/contacts` | ~ near | App splits the "client" surface into Households / Contacts / Policies under the **Book** rail section. No single "Client Workspace" node. |
| 3 | Pipeline | **Opportunities** · `/app/opportunities` (+ the whole **Pipeline** rail section: Reviews, Opportunities, Cases, Commissions, Cross-Sell, Life Win-Back, Life Conversion) | ~ section | "Pipeline" is a rail **section** in the app, not one page. |
| 4 | Revenue Center | **Revenue Center** · `/app/revenue` | ✅ exact | Keep (nav item under Executive). |
| 5 | Campaigns | **Campaigns** · `/app/comms/campaigns` (under Communications) | ✅ exact label | Lives inside the Communications workspace. |
| 6 | Cross-Sell Center | **Cross-Sell** · `/app/cross-sell` | ~ near | App label is "Cross-Sell" (no "Center"). |
| 7 | AI Command Center | **AI Workforce** · `/app/ai/workforce` (+ AI Operations `/app/ai`) | ~ near | App label is "AI Workforce" / "AI Operations". |
| 8 | Compliance Center | **Compliance** · `/app/compliance` (FSA) | ~ near | App label is "Compliance". *(The Compliance Intelligence destination listed here was excised 2026-08-28 — ADR-040.)* |
| 9 | Reports & Forecasting | **Dashboards** · `/app/dashboards` + **Forecasts** · `/app/forecasts` | ~ near | App splits into Dashboards + Forecasts (both under Executive). No combined "Reports & Forecasting" node. |
| 10 | Workshops | **Workshops** · `/app/workshops` | ✅ exact | Keep. |
| 11 | Documents | **Documents** · `/app/documents` (Admin: "Documents") | ✅ exact | Keep. |
| 12 | Calendar & Booking | **Calendar** · `/app/calendar` + **Booking** · `/app/booking` | ~ near | App has two nodes; mockup combines them. |
| 13 | Tasks & Workflows | **Workspace** workspace · `/app/tasks`, `/app/workflows` | ~ near | App groups Tasks + Workflows under the "Workspace" (Operate) workspace. |
| 14 | Communications | **Communications** · `/app/comms` | ✅ exact | Keep. |

## Proposed changes (for your approval — NOT applied)

These are **optional label alignments** only. Each is a one-line registry edit if you approve it.
None touches a route, destination, or authorization — label text only.

| Option | Current app label | Mockup label | Recommendation |
|---|---|---|---|
| A | Cross-Sell | Cross-Sell Center | **Hold.** "Cross-Sell" is cleaner and consistent with the other Pipeline workspaces (Reviews, Cases, Commissions — none carry "Center"). Adding "Center" to one breaks the set. |
| B | AI Workforce | AI Command Center | **Hold / discuss.** "AI Workforce" is a deliberate, descriptive name for the autonomous-agent roster (CLAUDE.md §11). "Command Center" reads more marketing than operational. |
| C | Compliance | Compliance Center | **Hold.** "Compliance" matches the compliance **portal** label; "Center" would imply a broader surface than the isolated Compliance Intelligence module actually is (ADR-012). |

## Structural note (explicitly out of scope for this redesign)

The mockup's **flat 14-item sidebar** vs the app's **rail + contextual sidebar** is an
**information-architecture** difference, not a styling one. Flattening the app to a single list
would remove the workspace model, change destinations, and touch the registry invariants — all
outside this presentation-only redesign. **No IA change is proposed or made.** The visual redesign
(Slice 2) restyles the existing two-tier nav to the mockup's look **without** changing its
structure, labels, or destinations.

## Bottom line

- **7 of 14** mockup labels already match the app exactly (Executive, Revenue Center, Campaigns,
  Workshops, Documents, Communications, and the Pipeline grouping).
- The rest differ only because the app organizes the same destinations into workspaces.
- **Recommendation: change nothing.** The existing labels are more consistent and more accurate to
  what each destination is. Approve any row above only if you specifically want the mockup's wording.
