# FSOS Build Order, Gap Closure & Acceptance Checklist

> The dependency-correct sequence Claude Code should follow so the app compiles at every step, plus the gap audit and the completeness checklist. Read `../CLAUDE.md` first, then build in the order below.

## PHASE 0 — Foundation (build before any feature; nothing works without it)
1. **Project scaffold:** Next.js 14 App Router + TS strict + Tailwind + shadcn/ui; route groups per portal (`routes.md`).
2. **Supabase:** project, `getDb()` client (`lib/supabase/client.ts`), migrations runner.
3. **Core schema + RLS:** the aggregate-root tables (`data-guardrails.md` §1) with RLS enabled (§2) and `audit_log` append-only.
4. **Auth + middleware:** `src/middleware.ts` + per-portal layout guards + `lib/auth/rbac.ts` (`middleware-auth.md`). MFA. Public allowlist.
5. **The four guardrail libs:** `lib/compliance/firewall.ts`, `lib/compliance/guardrail.ts`, `lib/comms/dispatcher.ts`, `lib/audit/log.ts`. **These exist and are enforced before any agent or send is built.**
6. **AI gateway:** `lib/ai/gateway.ts` (Claude-first, model-agnostic, cost/token logging, kill switch).
7. **Durable job runner:** `jobs/agent-runner.ts` + `app/api/cron/[job]/route.ts` wiring + idempotency/retry.
8. **Design system + archetype shells:** `components/archetypes/` (A1–A13) + status colors, skeletons, empty/error states, toasts.
9. **System pages:** `/login`, `/login/mfa`, reset, invite, 403/404/500/maintenance/offline.
**Gate:** `npm run build` clean; auth test matrix (`middleware-auth.md` §8) passes; a blocked test message is correctly hard-blocked + escalated.

## PHASE 1 — P0 (system-functional: the app operates end-to-end)
Build entities in spine order so each has its parent to reference:
1. **Agency Network:** `/app/agencies` list · `/new` · `/[id]` profile shell + P0 tabs (overview, referrals). API + RLS + audit.
2. **Referral:** inbox · new · detail · convert. Public `/refer` + `/refer/success`. Consent capture. `api/referrals/*`.
3. **Client & Household:** directory · new · profile shell + P0 tabs (members, policies) · member add/detail. `dob` encrypted.
4. **Policy & Coverage:** directory · new · detail (dates, status, is_security, conversion_deadline).
5. **Opportunity & Pipeline:** directory · board (Kanban, stage→audit) · new · detail (attribution, is_security gate, ffs_case_ref pointer).
6. **Tasks & Calendar:** my tasks · task detail · calendar. Google Calendar connect (A12) or manual fallback.
7. **AI escalations queue:** `/app/ai/escalations` (+detail) — the human-handoff surface must exist as soon as any automation can escalate.
8. **Compliance P0 surfaces:** firewall · licenses · consent · dnc (read/status).
9. **Super Admin P0:** users · roles · permissions · ai/policies (kill switches) · audit · security · backups.
10. **Executive dashboard** `/app` (P0) wired to real counts.
**Gate:** a referral can flow Agency→Referral→Household→Opportunity with audit at each step; no `is_security` record can be sent to; every P0 page meets Definition of Done.

## PHASE 2 — P1 (professional launch)
- Financial Review OS (the review spine: directory, board, workspace, prep, outcome→opportunity origination, calendar, due).
- Term Conversion OS (dashboard, eligible, timeline, monitoring, detail) + `conversion-watch` job (educational outreach only).
- Cross-Sell OS (list, household-gaps, detail) + `cross-sell-scan` job.
- Case Management OS (directory, board, new, detail, checklist, requirements).
- Commission OS (dashboard, expected/received/pending, splits config with assumption badges, record detail) + `commission-reconcile`.
- Marketing & Comms OS (unified timeline, sms/email inbox, templates + approval/versioning, campaigns + builder, suppression, delivery) + `campaign-dispatch` through the gate.
- Document OS (library, upload, requests, detail, virus scan, signed URLs, retention).
- AI Operations OS (center, agents, agent detail, runs, run detail, errors) + the agent roster (all green-zone; no NIGO agent).
- Compliance & Supervisory Portal (P-3) full; Agency-Owner Portal (P-4); Client Portal (P-5) P0/P1 pages; Reporting library + report view.
- Admin Portal: cases queue, document processing, data imports (wizard: mapping→preview→validate→error report→rollback→audit), support queue, user support.
- Executive: briefing (AI priorities), KPIs, production, performance, conversion/cross-sell overviews, alerts.
- Renewal/X-date/SLA/dormancy jobs live.
**Gate:** every P1 page Definition of Done; every automated send passes the 13-step gate (`docs/data-guardrails.md` §5); every agent run is logged with confidence + cost.

## PHASE 3 — P2 (operational enhancement)
Agency map/leaderboard/health/penetration · policy lapse-risk · review types config · analytics pages (conversion, cross-sell, comms, referral) · sequences/audience builder · workflow builder (triggers/conditions/delays/branching/failure/retry) · documents missing-detection · reports builder + scheduled · commission reconciliation/chargebacks/trails/adjustments/statements · AI evaluations · admin exports/duplicates · compliance legal-holds/attestations/policies · partner training/tasks · client reviews/case-status · super workflows/sandbox/webhooks.

## PHASE 4 — P3 (advanced future)
Custom dashboard builder · advanced forecasting · billing placeholder (only if commercialized).

---

## Dependency rules (what blocks what)
- Nothing before Phase 0 guardrails. **No agent or automated send may be built until `guardrail.ts` + `dispatcher.ts` + `firewall.ts` + `audit/log.ts` exist and pass tests.**
- Households require Agencies; Policies require Households; Opportunities require Households (+Products); Cases require Opportunities; Commissions require Opportunities.
- Reviews require Households + Policies; Term Conversion requires Policies (+ conversion_window config); Cross-Sell requires Policies (+ v_cross_sell_gaps).
- Campaigns require Consent + templates + the dispatcher gate.
- Partner/Client portals require RLS scope + column allowlists.

---

## Gap-closure audit (added because they were missing or underspecified, and are required)
1. **Notifications system** — in-app notification center + bell, email/SMS notification prefs (`/app/settings/notifications`), and a `notifications` table. Without it, "notifications triggered" in every archetype has nowhere to land.
2. **Global search + command palette** — `/api/search` across agencies/households/policies/opportunities/cases, scoped by RLS; ⌘K palette. Named in the shell but needs a backend.
3. **Error boundary + logging** — `app/error.tsx`, per-route error UI, and `/super/errors` fed by a real logger (not console).
4. **Rate limiting + bot protection** — on all public forms and auth routes (referenced in auth spec; must be implemented, e.g., middleware + captcha on public forms).
5. **Idempotency keys** — on all cron/job handlers and on `api/comms/send` to prevent double-sends on retry.
6. **Reassigned-number / opt-out sync** — Twilio inbound STOP handling wired to `consents`/DNC before the next send.
7. **Data seed + demo mode** — a seed script (agencies, households, products catalog, review types, default splits with assumption flags) so every list has a non-empty and an empty state to test.
8. **Backup + restore-test job** — `jobs/backup-verify.ts` + `/super/backups`; independent `pg_dump` export for ownership/portability.
9. **Incident/breach workflow** — `/compliance/incidents` with the Reg S-P/Safeguards 30-day clock; not just a page, a stateful workflow.
10. **Consent token pages** — public `/consent` + `/consent/preferences` reachable by tokenized link from every message footer (opt-out compliance).
11. **Empty product catalog guard** — Opportunity/Policy create must handle "no products configured yet" (send admin to `/super/products`).
12. **Impersonation audit + banner** — super/admin impersonation writes audit and shows a persistent banner.

---

## QA test matrix (every important workflow gets all paths)
For each of: referral intake→convert, household create, policy record, opportunity stage-advance, review→opportunity origination, term-conversion outreach, campaign send, commission split, case submission, document upload, AI agent run, consent capture/revoke — test **happy · empty · error · unauthorized · duplicate · cancellation · retry · recovery**.
Plus: unit · integration · e2e (seeded local Supabase) · permission/RLS · workflow · communication-gate · AI-guardrail (recommendation must be blocked) · security · accessibility (WCAG 2.1 AA) · responsive · browser · performance · load · backup · restore · data-migration · failure/retry.

---

## FINAL ACCEPTANCE CHECKLIST (system is not "done" until all true)
- [ ] No navigation link is dead (every list→detail→related records resolve; only completion screens terminate, and they offer a next action).
- [ ] No required page is missing (every route in `sitemap.md` exists at its `routes.md` path).
- [ ] No form lacks Zod validation (client + server).
- [ ] No workflow stops unexpectedly (every path in the QA matrix passes).
- [ ] No user role lacks its required pages; every portal's nav is permission-filtered.
- [ ] No protected page lacks permission enforcement (403 on forbidden deep link; RLS denies out-of-scope rows).
- [ ] No automated action lacks an audit trail (`audit_log` written on every mutation, send, block, and AI action).
- [ ] No AI agent exceeds its permissions (green-zone only; red-line recommendations hard-blocked in tests).
- [ ] No securities workflow crosses the FFS firewall (`is_security` never auto-sent; client portal never exposes securities fields).
- [ ] No communication bypasses consent + quiet-hours + suppression (the 13-step dispatcher gate; `docs/data-guardrails.md` §5).
- [ ] No page is complete without responsive + empty + loading + error + success states.
- [ ] No feature is complete unless wired to real data and covered by tests.
- [ ] Every Farmers-data assumption (splits, conversion windows, product availability) is a labeled, editable config default — none invented.
- [ ] NIGO appears nowhere in the codebase.
