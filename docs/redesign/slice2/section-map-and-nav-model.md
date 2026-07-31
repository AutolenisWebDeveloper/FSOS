# Nested Navigation Model + Section → Sub-page Map (for approval)

> **FRONTEND / navigation-structure only.** No route, destination, label, page, query, or logic
> changed. This re-presents the **existing Workspace Registry** (`src/lib/workspaces/registry.ts`)
> as a single, contextual, two-level sidebar. Authorization is unchanged (a pure function of the URL
> prefix, enforced by middleware + layout guards + RLS). **Nothing was renamed.**

## The model

- **One sidebar, no icon rail.** The thin icon-only rail is removed. There is now a single labeled
  sidebar (icon **+** label) on the navy shell.
- **Level 1 — Main Dashboard (`/app`):** the sidebar is the **section directory** — every workspace
  the portal can reach, grouped by section (Command · Pipeline · Book · Operate), icon + label. The
  main dashboard content (briefing hero, priority queue, funnel, business-health `not_configured`)
  renders alongside it. The current section (Executive) is the active **solid `#2C4C9C` pill**.
- **Level 2 — Section Dashboard (drill in):** clicking a section navigates into it; the sidebar
  **swaps** to that section's own sub-navigation, led by a **"← Back to Dashboard"** control and the
  section's header (icon + name + description). The content area is that section's existing page(s).
- **Contextual, not flattened, not modal:** the sidebar shows the directory at the root and swaps to
  the section's sub-items once you drill in. Sections are full dashboards with their own chrome, not
  overlays.
- **Single-workspace portals** (Partner, Client) have no meaningful directory, so they always show
  their section nav (unchanged behavior). Directory mode applies to multi-workspace portals
  (FSA, Admin, Compliance, Super).

Rendered proof at `docs/redesign/slice2/nav-model-{1440,768,375}.png` (Level 1 **and** a drilled-in
Level 2 = Cross-Sell, at all three widths; mobile collapses the sidebar to the existing drawer).

## FSA section → sub-page map (complete, from the registry — please approve)

Each **section** (Level 1 directory entry) → its **existing sub-pages** (Level 2 sidebar). Every
route already exists; the drill-in simply surfaces the registry's `nav` for that workspace.

### Command
| Section (Level 1) | Home | Sub-pages (Level 2) |
|---|---|---|
| **Executive** | `/app` | Overview, Daily Briefing, KPIs, Production, Performance, Conversion, Cross-Sell Signal, Alerts, Dashboards, Forecasts, Revenue Center, Notifications |
| **AI Workforce** | `/app/ai/workforce` | Workforce, AI Operations, Agents, Runs, Escalations, Evaluations, Errors, Assistant |
| **Financial Planning** | `/app/fna` | Overview, Plans, Generate FNA, Cash Flow, Net Worth, Protection, Retirement, Goals, Assumptions, Reports |
| **Communications** | `/app/comms` | Overview, Campaigns, Sequences, Templates, Library, Audience, SMS, Email, Delivery, Analytics, Suppression, Sender Identity |
| **Inbox** | `/app/comms/inbox` | Conversations |
| **Social** | `/app/social` | Overview, Content, Calendar, Queue, Accounts, Engagement, Analytics, Attribution, Health |

### Pipeline
| Section (Level 1) | Home | Sub-pages (Level 2) |
|---|---|---|
| **Cross-Sell** | `/app/cross-sell` | Overview, Household Gaps, Agency Penetration, Analytics, Import |
| **Life Win-Back** | `/app/winback` | Overview, Import |
| **Life Conversion** | `/app/conversions` | Overview, Eligible, Timeline, Monitoring, Analytics, Import |
| **Reviews** | `/app/reviews` | All Reviews, Due, Board, Calendar, Types, New Review |
| **Opportunities** | `/app/opportunities` | All Opportunities, Board, New Opportunity, OPRA Transfers, OPRA Eligible |
| **Cases** | `/app/cases` | All Cases, Board, Requirements, Service Requests, New Case |
| **Commissions** | `/app/commissions` | Overview, Expected, Received, Pending, Splits, Statements, Reconciliation, Discrepancies, GDC Tiers |

### Book
| Section (Level 1) | Home | Sub-pages (Level 2) |
|---|---|---|
| **Agencies** | `/app/agencies` | All Agencies, Map, Leaderboard, Add Agency, Import |
| **Contacts** | `/app/contacts` | All Contacts, Segments, Import Review, FFS Contacts, Add Contact, Import, Upload |
| **Referrals** | `/app/referrals` | All Referrals, Analytics, Add Referral |
| **Households** | `/app/households` | All Households, Add Household |
| **Policies** | `/app/policies` | All Policies, Lapse Risk, Add Policy |
| **Book Data** | `/app/book/import` | District Book Import |

### Operate
| Section (Level 1) | Home | Sub-pages (Level 2) |
|---|---|---|
| **Workspace** | `/app/tasks` | Tasks, Calendar, Booking, Workflows, Documents, Client Forms, Workshops, Knowledge Library, Sales Calculator, Reports |
| **Compliance** | `/app/compliance` | Overview, **Compliance Intelligence** (ADR-012, the only authorized compliance surface), Consent, DNC, Securities Firewall, Licenses, Settings, Help & Support |

## One behavior to confirm

At Level 1 (`/app`), the sidebar shows the **directory**, so the Executive section is "current" but
its *own* sub-pages (KPIs, Production, Revenue Center, …) are reached by drilling in (any
`/app/executive/*` or `/app/revenue` route flips to Level 2 with Executive's sub-nav + back). The
main dashboard already links into those. **If you'd prefer the home/Executive section to stay
expanded inline at Level 1** (so its sub-pages are always one click away from home), that's a small
tweak — tell me and I'll add it.

## Nothing renamed / no new destinations

- Every label and route above is exactly what's in the registry today.
- No workspace, nav item, or route was added, removed, reordered, or relabeled.
- The change is purely how the same registry is *presented* (single contextual sidebar vs. rail +
  sidebar).
