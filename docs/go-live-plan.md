# FSOS Go-Live Plan — Consolidate to App B, Retire App A

> **Decision:** App B (FSOS, `/app` + portals) is the platform. App A (legacy Command Center, `/`) ports its unique keepers in, hands over its data, and is retired. OPRA is retired outright (owner decision, confirmed).
>
> **Source:** the forensic audit (both apps traced to code). This plan only lists what the audit proved, not what the spec assumed.
>
> **Sequence is load-bearing.** Phase 0 is a live compliance exposure. Phase 1 protects your book. Do not reorder.

---

## What App A actually has that App B doesn't

The audit found App A's "extra features" are mostly screens, not function — AI Control Center, Review Prep, and Needs Map are hardcoded mocks; Conversions writes never persist; "Create Agency" is a no-op toast. App B does all of that for real.

**Genuine keepers (port these):**
| Feature | App A source | API | Port to |
|---|---|---|---|
| Global search | `TopSearch` :4839 | `GET /api/search` | App B topbar (⌘K) — **App B has no global search at all** |
| AI Assistant chat | `AssistantModal` :4179 | `POST /api/assistant` | `/app/ai/assistant` + topbar launcher |
| Client 360 AI actions | `ClientDrawer` :4903 | `POST /api/customers/next-action`, `/meeting-prep`, `/enrich` | Household profile drawer |
| Help & Support | `HelpPage` :4373 | none | `/app/help` |

**Retire outright:** OPRA Center (+ `api/opra`, `opra_cases` UI). Owner confirmed.

**Everything else in App A** is either duplicated by App B on a better model, or was never real.

---

## PHASE 0 — Compliance exposure (do first, blocking)

**Duplicate opt-out paths.** The audit found two parallel opt-out systems on different tables:
- `/unsubscribe` → `POST /api/consent/opt-out` → `consent_ledger` (legacy)
- `/consent` → `POST /api/public/consent` → `dnc_entries` (FSOS)

**An opt-out recorded in one is invisible to the other.** A client who opts out via the legacy link can still be messaged by an FSOS campaign. That is a live TCPA/Texas SB 140 exposure with a private right of action.

**Fix:**
1. Make `dnc_entries` the single source of truth.
2. Backfill every `consent_ledger` opt-out into `dnc_entries` (migration).
3. Point `/api/consent/opt-out` at `dnc_entries` (keep the URL alive — it's in sent messages).
4. Add a test: an opt-out via either path blocks a send via either system.

**Duplicate referral intake** (`/[slug]` → `agency_referrals` vs `/refer` → `referrals`) — same pattern, lower risk. Consolidate to `referrals`; keep `/[slug]` alive as a redirect (agencies may hold those links).

**Also outstanding:** migration `015_security_invoker_views.sql` (SECURITY DEFINER views bypass RLS — the securities firewall is bypassable via any view). Verify it shipped; if not, ship it here.

---

## PHASE 1 — Legacy data audit + migration (protects the book)

**Before any decommission**, answer: is there real data in the legacy tables?

1. **Row-count audit:** `customers`, `scores`, `opra_cases`, `commission_cases`, `agency_referrals`, `agencies`, `form_submissions`, `tasks`, `campaigns`, `activity`, `daily_briefings`, `documents`, `consent_ledger`. Report counts + date ranges.
2. **If rows exist**, migrate per `docs/legacy-mapping.md`:
   - `customers` → `households` + `household_members`
   - `agencies` → `agency_partnerships`
   - `agency_referrals` → `referrals`
   - `commission_cases` → `commissions`
   - `scores` → `opportunities` (or archive if scoring is retired)
   - `form_submissions` → `form_responses`
   - `consent_ledger` → `dnc_entries` (done in Phase 0)
   - `tasks` → `work_tasks`
3. **Idempotent, previewed, reversible.** Same discipline as the GHL importer: preview → commit → rollback token → audit.
4. **Never drop a legacy table.** Retire UI and routes only. Table drops are a separate decision after a full retention cycle.

---

## PHASE 2 — Port the four keepers

Each is a **new App B page** built to `docs/archetypes.md` Definition of Done and `docs/design-system.md` — real auth, RLS, audit. Not a copy-paste of legacy JSX.

**2.1 Global search** — `/api/search` reworked to query App B's model (`agency_partnerships`, `households`, `household_members`, `opportunities`, `household_policies`, `cases`), RLS-scoped, wired to the topbar ⌘K palette. **Firewall: never return an `is_security` row to a client/partner session.**

**2.2 AI Assistant** — `/app/ai/assistant`. Must route through `lib/ai/gateway.ts` (not the SDK directly) and pass `lib/compliance/guardrail.ts`. **Red line: the assistant may not make a product/investment recommendation.** Escalate instead. Log every turn to `agent_runs`/`agent_actions`.

**2.3 Client 360 AI actions** — next-action / meeting-prep / enrich, rebuilt against `households`, surfaced as a drawer on `/app/households/[id]`. Same gateway + guardrail. Educational/organizational output only — never a recommendation.

**2.4 Help** — `/app/help`, with FFS contacts pulled from the `ffs_contacts` config table (not hardcoded).

---

## PHASE 3 — Fix App B's real gaps

**3.1 Auth is incomplete (blocking).** The audit found `/forgot-password`, `/reset-password/[token]`, and `/invite/[token]` are **Not Connected** — static forms with no handler; `/verify/[token]` discards the token. Wire all four to Supabase Auth. **You are currently one lockout away from being unable to get in.**

**3.2 The AI layer isn't running.** `src/jobs/agent-runner.ts` is complete — kill switch, `agent_runs`/`agent_actions`, dispatch, escalation, retry — but **no cron invokes it** and it's absent from `vercel.json`. Decide: schedule it, or stop calling FSOS autonomous. If scheduling: add to `vercel.json`, verify the kill switch halts it, verify escalations land in `/app/ai/escalations`.

**3.3 Wire the Backend-Only routes** (real APIs no page calls):
- `POST /api/documents/requests` → add the "Request document" control on case/household
- `POST/PATCH /api/incidents` → wire to `/compliance/incidents` (currently read-only; the Reg S-P clock can't be started)
- `POST /api/comms/send` → intentional (campaign dispatch is the path) — document, don't wire
- `/api/customers/upsert` → legacy Make.com ingress; retire with App A

**3.4 Wire the UI-Only pages that shouldn't be:**
- `/admin`, `/compliance`, `/super` home tiles all render `—` — wire to real counts
- `/admin/documents/verify` — static empty state
- `/admin/users` — roster reads, but no invite/reset/unlock/impersonate controls
- `/admin/config/[section]` — reads, no add/edit
- `/super/products/[id]` — read-only, no edit form
- `/super/integrations` — reflects env vars only; no connect/test
- `/client`: `case-status`, `documents` (upload), `intake`, `profile`, `schedule` — described but not built
- `/partner`: `messages`, `schedule`, `settings` — static
- `/app/reports/[id]` — only 2 of the report types render

**Intentionally UI-only (leave):** `/app/tools/calculator` (client-side math by design), completion screens, static legal pages, `/super/roles` + `/super/permissions` + `/super/security` + `/super/states` (constants reflecting code — acceptable, but badge them "read-only").

**3.5 Delete dead code:** `ClientFormPortal.tsx`, `WorkshopRegister.tsx` (points at the wrong route), `fsos_forms_system.jsx`. Add the missing `(public)/layout.tsx`.

---

## PHASE 4 — Cutover

1. `/` redirects to `/app`.
2. Legacy public URLs **stay alive as redirects** — `/[slug]` → the FSOS referral intake, `/upload/[slug]` → the FSOS document upload. Agencies may hold these links; do not 404 them.
3. `/unsubscribe` stays alive, now writing to `dnc_entries` (it's printed in sent messages — never break it).
4. Legacy shell moves to `/legacy` behind Basic auth, read-only, 30-day grace, with a banner: *"Legacy view — read-only. FSOS is at /app."*

---

## PHASE 5 — Decommission (after grace, no regressions)

Delete `fsos_command_center.jsx`, `CommandCenter.tsx`, the legacy page shell, and the retired API routes (`api/opra`, `api/scores`, `api/customers/*`, `api/dashboard` legacy, `api/gdc/cases`, `api/briefing/send` legacy, `api/assistant` legacy once ported, `api/search` legacy once ported, `api/audit` legacy, `api/campaigns` legacy, `api/renewals`, `api/reports` legacy, `api/ghl/*` once the admin importer covers it).

**Legacy tables stay.** Remove `FSOS_ADMIN_PASSWORD` basic-auth only once `/` no longer serves legacy.

---

## Go-live gate (all must be true)

**Technical**
- [ ] Single opt-out source of truth; an opt-out via any path blocks a send via any path (tested)
- [ ] Migration 015 shipped; no SECURITY DEFINER views; firewall proven on views as the client role
- [ ] Legacy data migrated (or proven empty), previewed + reversible + audited
- [ ] Auth complete: login, MFA, forgot, reset, invite, verify
- [ ] `agent-runner` scheduled and kill-switch verified — or explicitly deferred in writing
- [ ] No UI-Only page that a user is expected to act on
- [ ] No dead nav links; every retired legacy item has a live FSOS replacement
- [ ] `npm run build` clean; all tests green (guardrail proofs, P0/P1 gates, RLS-on-views)
- [ ] Backups tested (restore, not just backup exists)

**Business / legal (external — not code, but gate go-live)**
- [ ] Real commission splits replace the 60/40 assumption defaults
- [ ] FNWL term-conversion window populated from the ICC25-FTL contract / SERFF filing
- [ ] FFS written sign-off on what FSOS may store re: securities clients
- [ ] WISP, Reg S-P incident plan, TCPA/SB 140 posture reviewed by counsel
- [ ] FFS compliance review of every approved outbound template (Reg BI boundary)
- [ ] Licenses current in `/app/compliance/licenses`; product paths gated to held registrations
