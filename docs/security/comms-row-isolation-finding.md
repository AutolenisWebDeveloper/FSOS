# SEC — Comms row-isolation is application-layer only (RLS thin on comm tables)

| Field | Value |
|---|---|
| **ID** | SEC-2026-08-comms-row-isolation |
| **Severity** | Medium (single-FSA today) → **High/blocker** before any 2nd tenant / partner / multi-advisor context |
| **Status** | **Open — accepted as a tracked finding** (owner-dispositioned 2026-08-03) |
| **Owner** | **Comms / campaign security model** (NOT the booking program) |
| **Escalated to** | **Platform security** — see §9 (the reliance pattern is comms-wide, likely beyond these two tables) |
| **Disposition** | Do **NOT** implement in the booking program. The correct fix is a cross-cutting comms-wide tenant-scoping policy + write-path validation, not a one-table FORCE toggle. Booking Phase-2 / campaign work is already active in these same files — a second branch adding RLS to the same core tables is exactly the §3 collision to avoid. |
| **Deliverable** | This blast-radius analysis (below), surfaced during P2.3, verified via `fsos-security-audit`. |
| **Source** | P2.3 appointment timeline (`lib/comms/timeline-load.ts`) reads `comm_messages` + `comm_message_events`; isolation was assumed but unverified. |

> **Accepted as a finding, not a task for booking.** The analysis is the deliverable; the fix is
> owned by the comms/campaign security model. Booking proceeds independently (P3 does not depend on
> this). Recorded in the deploy ledger (`docs/booking/deploy-notes.md`).

## 0. TL;DR

- **Finding:** `comm_messages` and `comm_message_events` have RLS **enabled but not FORCE'd**.
  Worse, `comm_messages` has **no row policy at all**, and `comm_message_events` has only a
  **role-gated** read policy (`mevt_read`) — **neither table has tenant/ownership scoping in RLS
  today.** The P2.3 timeline's row isolation is therefore **app-layer only** (service-role reads +
  the loader's `entity_type`/`entity_id` filter + role-based redaction), not database-enforced.
- **Adding FORCE is functionally safe** (zero blast radius): **every** app read/write path uses the
  service-role client `getDb()`, which has `BYPASSRLS` and bypasses policies **regardless of
  FORCE**. The dreaded "a too-tight policy silently breaks reminders/delivery tracking" **cannot
  happen from FORCE alone**, because no path depends on a policy predicate.
- **But FORCE alone does not create isolation.** It only closes the *owner-role* bypass
  (defense-in-depth, matching 077/078). Real per-tenant scoping requires **new policies** using the
  ownership columns below — a **comms/campaign security-model** decision that touches every comms
  consumer, not just booking.
- **Recommendation:** ship the FORCE-only hardening as isolated defense-in-depth **iff** we accept
  it changes nothing functionally today; hand the **tenant-scoping policy design** to the comms
  security owner; and record that DB-enforced isolation is a **hard prerequisite before any
  multi-tenant / partner-facing read path** to these tables.

## 1. Current state (verified facts)

| Fact | Evidence |
|---|---|
| `getDb()` = service-role client, **bypasses RLS** | `src/lib/supabase/client.ts:30` ("Server-side admin client (service role key, bypasses RLS)") |
| `load()` (all RSC/route reads) uses `getDb()` | `src/lib/data/query.ts:25,46,73` |
| `getBrowserDb()` (anon, RLS-respecting) is **unused** by any comms/timeline/page/job path | grep: referenced only in its own definition (`browser.ts`, `client.ts`) |
| `comm_messages` RLS **enabled** | `010_rls_guardrails.sql:99` (bulk `enable row level security` loop) |
| `comm_messages` has **no `create policy`** | grep across all migrations: none |
| `comm_message_events` RLS **enabled** | `033_...:203-211` (enable loop) |
| `comm_message_events` has **one** policy: `mevt_read` (SELECT), **role-gated not tenant-scoped** | `033_...:221-225` — `is_super() or compliance/supervisor/fsa/licensed_staff/admin` |
| **Neither** table is FORCE'd | grep `force row level security`: only `audit_log` (077), `ai_policies`/`ai_agents` (078) |

**Consequence:** for a *non-service, non-owner* connection (e.g. the shipped anon key + an
authenticated session hitting PostgREST directly): `comm_messages` → **deny-all** (RLS on, no
policy); `comm_message_events` → **all rows** if the JWT carries a staff role, else deny. For the
*owner* role: **all rows on both** (no FORCE). For *service_role* (the app): **all rows** (bypass).

## 2. (Q1) Tenant / ownership scoping columns

**`comm_messages`** carries several candidate ownership keys (added across 009/033/049):
`agency_id → agency_partnerships`, `household_id`, `member_id → household_members`,
`contact_id`, `policy_id → household_policies`, plus polymorphic `entity_type`/`entity_id`,
`campaign_id`, `conversation_id`. **None is currently used by an RLS policy**, and no single key is
guaranteed non-null (a booking message is keyed by `entity_type='appointment'`/`entity_id` and
`contact_id`; a campaign message by `campaign_id`/`member_id`/`household_id`). The natural tenant
axis is **`agency_id`** (partner tenant) and the FSA-book axis is **`household_id`** (resolved to
the FSA's book), mirroring the `agency_partnerships`/`households` policies in 010.

**`comm_message_events`** has **no ownership column of its own** — it scopes **only** via
`message_id → comm_messages(id)`. Any tenant-scoped events policy must therefore be a **join/EXISTS
predicate** back to the parent message, e.g.:

```
using ( exists (select 1 from comm_messages m
                where m.id = comm_message_events.message_id
                  and <the same tenant predicate applied to comm_messages>) )
```

Today's `mevt_read` does **not** join to the parent — it grants any staff-role JWT read of **all**
events. So events isolation is role-coarse, not tenant-fine.

## 3. (Q2) Blast radius — every path, and why FORCE keeps it working

All of the following use `getDb()` (service role, `BYPASSRLS`). Under FORCE RLS, **service_role
still bypasses** — so **every path below is unaffected**. The "silently breaks reminders/delivery"
failure mode requires a path that *relies on a policy predicate*; there is none.

| Path | File(s) | Table ops | Under FORCE |
|---|---|---|---|
| Comms gate / dispatcher (the one send path) | `src/lib/comms/send.ts` | insert/update `comm_messages` | ✅ service-role bypass |
| Delivery events (queued/sent/delivered/failed/bounced/opened/clicked/replied) | `src/lib/comms/events.ts` | insert `comm_message_events`, update `comm_messages` | ✅ bypass |
| Provider webhooks (Resend / Twilio status) | `src/app/api/webhooks/*`, via `events.ts` | insert events / update status | ✅ bypass |
| Open/click tracking pixels | `src/app/api/track/{open,click}/[id]/route.ts` | update `comm_messages` | ✅ bypass |
| Inbound (STOP/HELP/replies) | `src/lib/comms/inbound.ts` | insert `comm_messages` | ✅ bypass |
| Cron reminders + booking notify | `src/jobs/handlers.ts`, `src/lib/booking/notify.ts` (→ `send.ts`) | read/insert/update | ✅ bypass |
| Campaign / sequence / workshop / winback / cross-sell ticks | via `send.ts` | insert `comm_messages` | ✅ bypass |
| Policy resolver (frequency/collision) | `src/lib/comms/policy-resolver.ts` | read `comm_messages` | ✅ bypass |
| **P2.3 appointment timeline loader** | `src/lib/comms/timeline-load.ts` | read both | ✅ bypass |
| Delivery page (FSA) / Communications (compliance) / comms analytics/inbox/email/sms | `src/app/(fsa)/app/comms/*`, `(compliance)/compliance/communications` | read via `load()` | ✅ bypass |

**Net functional blast radius of FORCE-only: none.** The only access *newly denied* is a direct
owner-role connection — which no runtime path uses.

**What FORCE does NOT fix:** it does not add tenant scoping. If a future partner/client surface
reads these tables through an **RLS-respecting** client (anon + user JWT), it would hit
`comm_messages` deny-all (no rows) or `comm_message_events` role-coarse (all-or-nothing) — i.e. it
needs **real policies first**. That work is out of scope for a FORCE-only hardening.

## 4. (Q3) Rollback

FORCE is a single reversible attribute flip; no data migration, no policy change:

```
alter table comm_messages       no force row level security;
alter table comm_message_events no force row level security;
```

Because the app uses service-role throughout, both applying and rolling back FORCE are **no-ops for
the running application** — rollback risk is effectively zero. (If tenant policies are added later,
their rollback is `drop policy` + optionally `no force`; a policy rollback is higher-risk and must
be designed with that policy, not here.)

## 5. What could go wrong (adversarial)

- **False sense of security (primary risk):** shipping FORCE and marking "RLS isolation done" when
  no tenant policy exists. FORCE hardens the owner path but leaves comms row-isolation entirely
  app-layer. This document + the ledger entry (§8) exist to prevent that misread.
- **Future RLS-respecting reader added without a policy:** a partner/client comms view built on
  `getBrowserDb()` would silently return **zero** `comm_messages` rows (deny-all) — a functional
  break, not a leak. Mitigation: the tenant-policy design (§6) is a prerequisite for any such reader.
- **`mevt_read` over-grants at the direct-PostgREST layer:** any staff-role JWT can read *all*
  events directly (not tenant-scoped). Not a regression from FORCE, but worth tightening when the
  scoping model lands (join to parent message).

## 6. Design for real tenant scoping (when it's owned & needed — NOT this change)

When a multi-tenant/partner read path is introduced, add policies (illustrative, to be owned by the
comms security model, aligned to the 010 helpers `is_super()/has_role()/book/agency scope`):

- `comm_messages` SELECT: `is_super() or staff-role` **OR** `agency_id in (the caller's agencies)`
  **OR** `household_id in (the caller's book/household)` — using the same scope subqueries as the
  `households`/`agency_partnerships` policies. Decide null-key handling (a message with only
  `entity_id` must resolve a tenant).
- `comm_message_events` SELECT: EXISTS-join to `comm_messages` applying the same predicate (§2).
- Writes remain service-role only (no INSERT/UPDATE policy for authenticated), as today.
- Proof: extend `tests/rls-firewall.test.mjs` with cross-agency read-denial for both tables.

## 7. (Q4) Ownership & recommended disposition

This is **not booking-specific** — it touches every comms consumer (dispatcher, campaigns,
tracking, inbound, workshops, all campaign ticks). Two separable pieces:

1. **FORCE-only hardening** (defense-in-depth, closes owner bypass; zero functional blast radius).
   *Safe* to ship from the booking program as an isolated migration **iff** the owner accepts it
   changes nothing today and is explicitly **not** "comms RLS isolation." Mirrors 077/078.
2. **Tenant-scoping policy design** (the actual row isolation). **Hand to the comms/campaign
   security-model owner.** It requires product decisions (which tenant axis, null-key handling,
   partner read surfaces) affecting all comms consumers, and its own RLS test coverage.

**Recommendation:** treat (1) and (2) as distinct. Do **not** let a booking-program FORCE migration
imply (2) is done.

**OWNER DISPOSITION (2026-08-03): hand off, do NOT slice into booking.** Neither (1) nor (2) ships
from the booking program. Two hard reasons: **(a) collision (§3)** — the campaign Phase-2 work is
already active in these same comms files; two branches adding RLS to the same core tables is exactly
the fragmentation the architecture-preservation rule exists to prevent. **(b) correctness** — the
right fix is a **comms-wide tenant-scoping policy + write-path validation**, not a one-table FORCE
toggle. The comms/campaign security-model owner takes both (1) and (2) together. Booking's output is
this finding + the ledger note; booking proceeds to P3 (which does not depend on this).

## 9. Platform-security escalation

**Observation to escalate (accurate mechanism — do not garble it):** the comms surface relies
**entirely on the service-role client + application-layer scoping** for row isolation, **not** on
RLS. Concretely: `comm_messages` has **no row policy**, `comm_message_events` has only a
**role-coarse** read policy (any staff JWT → all events), and **every** code path uses `getDb()`
(service role, `BYPASSRLS`). This is the *opposite* of an "anon-write / no-service-role" problem —
it is a **universal-service-role, RLS-not-enforcing** posture.

**Why platform security, not booking:** if this pattern holds across the comms/campaign surface
(and the shared `send.ts`/`events.ts`/policy-resolver paths suggest it does), then **RLS across the
whole comms/campaign surface may be thinner than assumed** — role-coarse or absent tenant scoping,
with isolation resting on service-role + app code. That is a platform-wide security-model question
(is RLS meant to be a real enforcement layer here, or is service-role + app-layer the accepted
model?), above the booking program's scope to resolve. **Ask platform security to confirm the
intended model and, if RLS is meant to enforce, scope the comms-wide policy + write-path-validation
work.**

## 8. Deploy-ledger entry (record regardless of disposition)

> **Comms RLS is app-layer only.** `comm_messages` (no policy) and `comm_message_events`
> (`mevt_read`, role-coarse) are RLS-enabled but **not tenant-scoped and not FORCE'd**. Every app
> path reads via service-role (`getDb`, BYPASSRLS), so the P2.3 appointment timeline's row isolation
> is enforced in application code, **not** the database. **Hard prerequisite:** before any
> multi-tenant / partner-facing read path touches these tables, add tenant-scoping policies (§6) and
> FORCE, with `rls-firewall` coverage. Owner: comms/campaign security model. (Recorded 2026-08-03.)
