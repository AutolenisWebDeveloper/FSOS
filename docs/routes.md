# FSOS Route → File-Path Map (Next.js 14 App Router)

> Resolves every sitemap route to its file. Route groups isolate each portal's layout + auth.
> Convention: pages are `page.tsx`; each portal group has a `layout.tsx`; API routes are `route.ts` and MUST export `dynamic='force-dynamic'` and `runtime='nodejs'` (see `../CLAUDE.md` §1).

## Top-level structure
```
src/
  middleware.ts                      # portal auth routing (see middleware-auth.md)
  app/
    (public)/                        # P-0 unauthenticated
    (fsa)/                           # P-1  → URL /app/*
    (admin)/                         # P-2  → URL /admin/*
    (compliance)/                    # P-3  → URL /compliance/*
    (partner)/                       # P-4  → URL /partner/*
    (client)/                        # P-5  → URL /client/*
    (super)/                         # P-6  → URL /super/*
    api/                             # route handlers (server)
    layout.tsx                       # root layout (providers, fonts)
    globals.css
  lib/
    supabase/client.ts               # getDb() — the ONLY Supabase entry point
    ai/gateway.ts                    # model-agnostic AI gateway
    compliance/guardrail.ts          # green-zone/red-line validator (hard block)
    comms/dispatcher.ts              # consent/quiet-hours/DNC/firewall gate
    auth/rbac.ts                     # role + scope checks
    audit/log.ts                     # append-only audit writer
    validation/                      # Zod schemas (source of truth for types)
  components/ui/                      # shadcn/ui
  components/archetypes/             # reusable A1–A13 shells (see archetypes.md)
  jobs/                              # durable background jobs / cron handlers
```

## Route groups & layouts
| Group | URL prefix | Layout file | Auth (middleware-auth.md) |
|---|---|---|---|
| `(public)` | `/` | `app/(public)/layout.tsx` | none (public) |
| `(fsa)` | `/app` | `app/(fsa)/layout.tsx` | role: fsa / licensed_staff |
| `(admin)` | `/admin` | `app/(admin)/layout.tsx` | role: admin / ops / case_manager |
| `(compliance)` | `/compliance` | `app/(compliance)/layout.tsx` | role: compliance / supervisor |
| `(partner)` | `/partner` | `app/(partner)/layout.tsx` | role: agency_owner (scoped to own agency) |
| `(client)` | `/client` | `app/(client)/layout.tsx` | role: client (scoped to own household) |
| `(super)` | `/super` | `app/(super)/layout.tsx` | role: super_admin (MFA mandatory) |

---

## P-0 Public → `app/(public)/`
```
page.tsx                                   /
about/page.tsx                             /about
education/page.tsx                         /education
education/[slug]/page.tsx                  /education/[slug]
refer/page.tsx                             /refer
refer/success/page.tsx                     /refer/success
schedule/page.tsx                          /schedule
schedule/success/page.tsx                  /schedule/success
events/page.tsx                            /events
events/[id]/page.tsx                       /events/[id]
events/[id]/register/page.tsx              /events/[id]/register
events/[id]/register/success/page.tsx      /events/[id]/register/success
consent/page.tsx                           /consent
consent/preferences/page.tsx               /consent/preferences
privacy/page.tsx  terms/page.tsx  disclosures/page.tsx  support/page.tsx
login/page.tsx                             /login
login/mfa/page.tsx                         /login/mfa
forgot-password/page.tsx                   /forgot-password
reset-password/[token]/page.tsx            /reset-password/[token]
invite/[token]/page.tsx                    /invite/[token]
verify/[token]/page.tsx                    /verify/[token]
```
System pages: `app/not-found.tsx` (404), `app/error.tsx` (500 boundary), `app/(public)/403/page.tsx`, `maintenance/page.tsx`, `offline/page.tsx`.

## P-1 FSA → `app/(fsa)/app/`
```
page.tsx                                   /app                (Executive dashboard)
briefing/page.tsx  kpis/page.tsx  production/page.tsx  alerts/page.tsx
performance/referrals/page.tsx  performance/placements/page.tsx  performance/commission/page.tsx
opportunities/conversion/page.tsx  opportunities/cross-sell/page.tsx
trends/page.tsx  forecasts/page.tsx  goals/page.tsx  compare/page.tsx
dashboards/page.tsx  dashboards/builder/page.tsx  dashboards/[id]/page.tsx

agencies/page.tsx                          /app/agencies
agencies/map/page.tsx  agencies/leaderboard/page.tsx  agencies/new/page.tsx
agencies/activation/page.tsx  agencies/dormant/page.tsx
agencies/[id]/page.tsx                     /app/agencies/[id]        (profile shell)
agencies/[id]/[tab]/page.tsx               overview|staff|activation|relationship|notes|
                                           meetings|training|referrals|opportunities|production|
                                           commissions|engagement|documents|communications|goals|
                                           penetration|health   (render tab; validate tab param)

referrals/page.tsx  referrals/new/page.tsx  referrals/routing/page.tsx  referrals/sla/page.tsx
referrals/aging/page.tsx  referrals/duplicates/page.tsx  referrals/analytics/page.tsx
referrals/[id]/page.tsx  referrals/[id]/convert/page.tsx  referrals/[id]/reject/page.tsx

households/page.tsx  households/new/page.tsx  households/merge/page.tsx
households/[id]/page.tsx                    (profile shell)
households/[id]/[tab]/page.tsx             overview|members|relationships|dependents|beneficiaries|
                                           products|coverage|financial-snapshot|needs-analysis|goals|
                                           documents|consent|preferences|notes|activities|appointments|
                                           opportunities|policies|reviews|referring-agency|portal-access
households/[id]/members/new/page.tsx
households/[id]/members/[mid]/page.tsx

policies/page.tsx  policies/new/page.tsx  policies/lapse-risk/page.tsx  policies/renewals/page.tsx
policies/[id]/page.tsx

reviews/page.tsx  reviews/board/page.tsx  reviews/new/page.tsx  reviews/calendar/page.tsx
reviews/due/page.tsx  reviews/types/page.tsx
reviews/[id]/page.tsx  reviews/[id]/prep/page.tsx  reviews/[id]/outcome/page.tsx

conversions/page.tsx  conversions/eligible/page.tsx  conversions/timeline/page.tsx
conversions/monitoring/page.tsx  conversions/analytics/page.tsx  conversions/[id]/page.tsx

cross-sell/page.tsx  cross-sell/household-gaps/page.tsx  cross-sell/agency-penetration/page.tsx
cross-sell/analytics/page.tsx  cross-sell/[id]/page.tsx

opportunities/page.tsx  opportunities/board/page.tsx  opportunities/new/page.tsx
opportunities/[id]/page.tsx

cases/page.tsx  cases/board/page.tsx  cases/new/page.tsx  cases/requirements/page.tsx
cases/service-requests/page.tsx  cases/[id]/page.tsx  cases/[id]/checklist/page.tsx

commissions/page.tsx  commissions/expected/page.tsx  commissions/received/page.tsx
commissions/pending/page.tsx  commissions/splits/page.tsx  commissions/reconciliation/page.tsx
commissions/discrepancies/page.tsx  commissions/chargebacks/page.tsx  commissions/trails/page.tsx
commissions/adjustments/page.tsx  commissions/statements/page.tsx  commissions/[id]/page.tsx

comms/layout.tsx (CommsSubnav)  comms/page.tsx  comms/inbox/page.tsx  comms/inbox/[id]/page.tsx
comms/sms/page.tsx  comms/email/page.tsx  comms/templates/page.tsx  comms/templates/[id]/page.tsx
comms/campaigns/page.tsx  comms/campaigns/new/page.tsx  comms/campaigns/[id]/page.tsx
comms/sequences/page.tsx  comms/audience/page.tsx  comms/library/page.tsx
comms/assignments/page.tsx  comms/identity/page.tsx (+ identity-editor.tsx)
comms/suppression/page.tsx  comms/delivery/page.tsx  comms/analytics/page.tsx

documents/page.tsx  documents/upload/page.tsx  documents/requests/page.tsx
documents/missing/page.tsx  documents/[id]/page.tsx

tasks/page.tsx  tasks/team/page.tsx  tasks/[id]/page.tsx
calendar/page.tsx  calendar/availability/page.tsx  calendar/appointment-types/page.tsx
appointments/[id]/page.tsx
workflows/page.tsx  workflows/builder/page.tsx  workflows/[id]/page.tsx

ai/page.tsx  ai/agents/page.tsx  ai/agents/[id]/page.tsx  ai/runs/page.tsx  ai/runs/[id]/page.tsx
ai/escalations/page.tsx  ai/escalations/[id]/page.tsx  ai/errors/page.tsx  ai/evaluations/page.tsx

compliance/page.tsx  compliance/firewall/page.tsx  compliance/licenses/page.tsx
compliance/consent/page.tsx  compliance/dnc/page.tsx  compliance/exceptions/page.tsx

reports/page.tsx  reports/builder/page.tsx  reports/[id]/page.tsx  reports/scheduled/page.tsx

settings/page.tsx  settings/profile/page.tsx  settings/notifications/page.tsx
settings/security/page.tsx  settings/integrations/page.tsx
```

## P-2 Admin → `app/(admin)/admin/`
```
page.tsx  cases/page.tsx  documents/page.tsx  documents/verify/page.tsx
data/imports/page.tsx  data/imports/[id]/page.tsx  data/exports/page.tsx  data/duplicates/page.tsx
support/requests/page.tsx  support/requests/[id]/page.tsx  users/page.tsx
config/[section]/page.tsx        (tags|statuses|loss-reasons|appointment-types|review-types|templates)
```

## P-3 Compliance → `app/(compliance)/compliance/`
```
page.tsx  audit/page.tsx  audit/[id]/page.tsx  communications/page.tsx  approvals/page.tsx
consent/page.tsx  licenses/page.tsx  firewall/page.tsx  violations/page.tsx  exceptions/page.tsx
escalations/page.tsx  incidents/page.tsx  legal-holds/page.tsx  retention/page.tsx
attestations/page.tsx  policies/page.tsx
```

## P-4 Partner → `app/(partner)/partner/`
```
page.tsx  refer/page.tsx  referrals/page.tsx  referrals/[id]/page.tsx  production/page.tsx
commissions/page.tsx  materials/page.tsx  schedule/page.tsx  training/page.tsx
messages/page.tsx  tasks/page.tsx  settings/page.tsx
```

## P-5 Client → `app/(client)/client/`
```
page.tsx  schedule/page.tsx  intake/page.tsx  documents/page.tsx  documents/requests/page.tsx
education/page.tsx  appointments/page.tsx  profile/page.tsx  preferences/page.tsx
consent/page.tsx  reviews/page.tsx  case-status/page.tsx
```

## P-6 Super → `app/(super)/super/`
```
page.tsx  users/page.tsx  roles/page.tsx  permissions/page.tsx  orgs/page.tsx  districts/page.tsx
agencies/page.tsx  carriers/page.tsx  products/page.tsx  products/[id]/page.tsx  states/page.tsx
workflows/page.tsx
ai/agents/page.tsx  ai/prompts/page.tsx  ai/models/page.tsx  ai/policies/page.tsx  ai/sandbox/page.tsx
templates/page.tsx  integrations/page.tsx  integrations/[id]/page.tsx  feature-flags/page.tsx
audit/page.tsx  retention/page.tsx  security/page.tsx  jobs/page.tsx  jobs/[id]/page.tsx
webhooks/page.tsx  api-keys/page.tsx  errors/page.tsx  usage/page.tsx  health/page.tsx
backups/page.tsx  billing/page.tsx        (P3 placeholder)
```

---

## API routes → `app/api/`
Group by domain; all export `dynamic='force-dynamic'`, `runtime='nodejs'`; all writes validated with Zod; all mutations write audit.
```
api/agencies/route.ts          GET list / POST create
api/agencies/[id]/route.ts     GET / PATCH / DELETE(soft)
api/referrals/route.ts  api/referrals/[id]/route.ts  api/referrals/[id]/convert/route.ts
api/households/route.ts  api/households/[id]/route.ts  api/households/merge/route.ts
api/policies/route.ts  api/policies/[id]/route.ts
api/reviews/route.ts  api/reviews/[id]/route.ts  api/reviews/[id]/outcome/route.ts
api/conversions/route.ts  api/cross-sell/route.ts
api/opportunities/route.ts  api/opportunities/[id]/route.ts  api/opportunities/[id]/stage/route.ts
api/cases/route.ts  api/cases/[id]/route.ts  api/cases/[id]/requirements/route.ts
api/commissions/route.ts  api/commissions/[id]/route.ts  api/commissions/splits/route.ts
api/comms/send/route.ts        # → lib/comms/dispatcher (compliance gate)
api/comms/templates/route.ts  api/comms/campaigns/route.ts
api/documents/route.ts  api/documents/[id]/route.ts  api/documents/upload/route.ts
api/tasks/route.ts  api/calendar/route.ts  api/appointments/route.ts
api/ai/run/route.ts            # enqueue an agent run (durable job)
api/ai/escalations/route.ts
api/consent/route.ts           # public-callable (token) + internal
api/webhooks/ghl/route.ts      # inbound (existing)
api/webhooks/twilio/route.ts   api/webhooks/email/route.ts
api/reports/route.ts  api/reports/[id]/export/route.ts
api/admin/imports/route.ts     api/admin/imports/[id]/route.ts
api/super/users/route.ts  api/super/roles/route.ts  api/super/integrations/route.ts
api/super/jobs/route.ts  api/super/feature-flags/route.ts
api/health/route.ts
```

## Background jobs / cron → `jobs/` (invoked by Vercel Cron via `app/api/cron/[job]/route.ts`)
```
jobs/renewal-watch.ts          # generate renewal review tasks (60/30/14d)
jobs/conversion-watch.ts       # detect term-conversion windows → educational outreach
jobs/xdate-watch.ts            # competitor X-date cadence
jobs/referral-sla.ts           # aging/SLA escalation
jobs/agency-dormancy.ts        # detect dormant agencies → reactivation task
jobs/cross-sell-scan.ts        # coverage-gap detection
jobs/commission-reconcile.ts   # expected vs received
jobs/campaign-dispatch.ts      # send due campaign steps THROUGH the compliance gate
jobs/agent-runner.ts           # durable agent execution + escalation
jobs/data-quality.ts           # dedupe/enrichment flags
jobs/backup-verify.ts          # restore-test signal
```
Each cron handler: checks the kill switch, is idempotent (dedupe key), retries with backoff, logs to `agent_runs`/`audit_log`, and routes client-facing output through `lib/comms/dispatcher.ts`.
