# Native Communications Platform — Slice 9A: Navigation Consolidation

> Part A of Slice 9 (§19–§22). Navigation/IA only — kept a **separate PR** from the ~30-template
> work per the owner's direction. No route changes, no redirects, no migration. GHL untouched (§0.A).

## Problem

Only two comms entries were reachable from the sidebar — "Comms" (`/app/comms`) and "Inbox". Campaigns,
templates, sequences, sms, email, suppression, delivery, analytics, audience, assignments, and the new
library were unreachable from navigation.

## What shipped

| Concern | Delivery |
|---|---|
| **Root nav moved + renamed** | The comms hub is renamed **"AI Communications Center"** and moved from **Engage → Overview**, positioned beside AI Command Center and Revenue Center (`src/app/(fsa)/layout.tsx`). A distinct `Radio` icon distinguishes it from the Inbox shortcut. |
| **Inbox shortcut kept** | `/app/comms/inbox` intentionally stays in **Engage** (a daily-use surface); the duplicate entry to the same route is deliberate. |
| **Everything else unchanged** | All other Engage items (Knowledge Library, Contact Upload, Client Forms, Workshops, Workshop Approvals, Documents, Workflows, Tasks, Calendar, Sales Calculator) stay exactly where they are. No other nav entry moved or was removed. |
| **`/app/comms` is now an Overview page** | Not a redirect — an operational dashboard: active campaigns, pending approvals, conversations awaiting response, recent replies, assignment-review depth, delegation exceptions, suppression (7d), delivery failures (7d), quiet-hour/frequency blocks (7d), and today's send volume. Each tile links to the surface that resolves it. The live message timeline remains below. |
| **Sub-navigation** | A comms **layout** (`src/app/(fsa)/app/comms/layout.tsx`) renders a grouped sub-nav (`CommsSubnav`) on every comms route so all surfaces are reachable from within the hub: **Campaigns** (campaigns, new, sequences, audience, library), **Conversations** (inbox, sms, email), **Templates**, **Governance** (suppression, assignment review, identity disclosure), **Insight** (analytics, delivery). Detail routes (`campaigns/[id]`, `inbox/[id]`, `templates/[id]`, the campaign simulation preview) are reached from their list pages and highlight their parent. |

## Preserved routes

Every existing route is unchanged — this is IA + a layout/sub-nav component only. Settings remain under
`/app/settings/communications/*` (out of this sub-nav). The spec's `delegations` and `consent/preferences`
Governance items have no dedicated `/app/comms` route today (delegation exceptions surface in the
assignment-review queue; consent management lives under `/app/compliance/consent`), so no dead links were
created — the sub-nav links only real routes.

## Metric fail-safety

Every overview tile is computed by a config-safe `countOf` helper: a missing table/column or a DB error
resolves to `—` rather than breaking the page, so the hub renders even before every downstream surface has
data.

## Verification

`type-check` · `lint` · `npm test` (unchanged — no test logic touched) · `build` — all green. No new
design token or component *variant* introduced (a layout + a nav list), so no `DESIGN.md` change; no
architecture reversed, so no ADR.
