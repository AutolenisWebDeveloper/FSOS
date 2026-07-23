# Outbound Exposure Check (D0 prerequisite)

> What can send an automated message today, what gates it, how to see what's live, and how to
> halt outbound fast. Repo-grounded (`src/lib/comms/*`, `src/jobs/*`, `vercel.json`,
> `supabase/migrations/*`). Answered **before** writing D0 code so we know the blast radius.

## 1. What causes an automated send today

Every outbound message — automated or manual — funnels through `sendThroughGate` → `dispatch` →
`evaluateGate` → `messaging.ts` (Twilio/Resend). The things that *initiate* a send without a human
in the loop:

| Trigger | Code | Fires when |
|---|---|---|
| **Broadcast campaign dispatch** | `jobs/handlers.ts` `campaignDispatch()` | Cron `campaign-dispatch`. Selects `comm_campaigns` where `status='active' AND archived_at IS NULL AND (schedule_at IS NULL OR schedule_at <= now)`, then `dispatchCampaign()` sends to the resolved audience immediately (through the gate). |
| **Drip sequence advance** | `jobs/handlers.ts` `dripAdvance()` | Same cron tick. Selects `comm_campaign_enrollments` where `status='enrolled' AND next_send_at <= now`, joined to a `type='drip'`, `status='active'`, non-archived campaign with a `sequence_id`; sends the current step (through the gate). |
| **AI workforce outreach** | `jobs/handlers.ts` `workforceOrchestrator()` → `lib/ai/workforce` | Only if the `workforce-orchestrator` job is invoked. **Not on the Vercel schedule** (see §2) — it runs only via a manual/other `/api/cron/[job]` call. Kill-switch-gated per agent + globally. |
| **Manual one-off / inbox reply** | `/api/comms/send`, `/api/comms/conversations/[id]` POST | A human action in the UI (still gated). |
| **Legacy drip** | `/api/campaigns/run` (POST, internal-auth) | Not on the Vercel schedule; external/manual trigger only. |
| **Inbound AI auto-reply** | `inbound.ts` `tryAutoReply` | An inbound reply on a thread with `ai_autoreply=true` (AI-policy gated, §3). |

**The automated driver in production is the daily `campaign-dispatch` cron** (broadcasts + drips).
Nothing else sends on a schedule today.

## 2. The cron path

`vercel.json` schedules exactly two jobs:

```json
{ "path": "/api/cron/renewal-watch",     "schedule": "0 9 * * *" },   // 09:00 UTC — task-only, no sends
{ "path": "/api/cron/campaign-dispatch", "schedule": "0 12 * * *" }   // 12:00 UTC — the send driver
```

`renewal-watch` only creates `work_tasks` (no client send). **`campaign-dispatch` is the only
scheduled path that sends.** Entry point `src/app/api/cron/[job]/route.ts` (`GET`) authorizes on
the `x-vercel-cron` header **or** `Authorization: Bearer ${CRON_SECRET}`, then runs
`runIdempotent('job:date', …)` so a given job runs at most once per calendar day.

## 3. What gates outbound — the AI kill switch and its default

- **Per-message gate (always on):** the 7-step `evaluateGate` (consent, quiet hours, DNC,
  approved template, recommendation, `is_security`, other-rule). This blocks individual messages;
  it is not an on/off switch.
- **AI gateway kill switch:** `ai_policies.gateway_enabled`.
  - **Schema default is `true`** — `009_aggregate_root_core.sql`: `gateway_enabled boolean not null
    default true`; `010_rls_guardrails.sql` seeds the singleton `('global', true)`.
  - **Code default is also ON** — `send.ts` `hasApprovedAiPolicy()`:
    `const gatewayOn = pol?.gateway_enabled !== false` → a missing/null row reads as **enabled**.
    Also honors the env kill switch `AI_GATEWAY_DISABLED === '1'` (→ off) and a per-agent
    `ai_agents.enabled` flag.
  - Managed at **`/super/ai/policies`** (`src/app/(super)/super/ai/policies/page.tsx`,
    `src/app/api/super/ai/policies/route.ts`).
- **Critical scope limit:** the AI kill switch only gates **AI-authored, non-template** sends
  (gate step 4's "approved AI policy" path — the workforce and AI auto-replies). **Template-based
  broadcast/drip campaigns do NOT depend on it** — they pass step 4 via an *approved template*, not
  an AI policy. So **flipping `gateway_enabled=false` does NOT stop template campaigns/drips.**

## 4. SQL — list ACTIVE campaigns with due enrollments (run against prod read-replica; do NOT let me run it)

Mirrors the exact predicates in `campaignDispatch()` and `dripAdvance()`:

```sql
-- Active, non-archived, currently-due campaigns + their pending enrollment counts.
select
  c.id,
  c.name,
  c.type,                                   -- broadcast | drip
  c.channel,
  c.status,
  c.schedule_at,
  count(e.id) filter (
    where e.status = 'enrolled' and e.next_send_at <= now()
  )                                          as due_enrollments,      -- what dripAdvance would send now
  count(e.id) filter (where e.status = 'enrolled') as enrolled_total
from comm_campaigns c
left join comm_campaign_enrollments e on e.campaign_id = c.id
where c.status = 'active'
  and c.archived_at is null
  and (c.schedule_at is null or c.schedule_at <= now())   -- a broadcast here sends at the next tick
group by c.id
order by due_enrollments desc, c.schedule_at nulls first;
```

A **broadcast** row with rows in its audience sends to the whole audience at the next 12:00 UTC
tick; a **drip** row sends to its `due_enrollments` count. Companion "how many recipients does a
broadcast resolve to" depends on the campaign's `audience` (see `campaign.ts resolveAudience`), so
treat any active broadcast as "will send to its full audience next tick."

## 5. Fastest way to halt all outbound

There is **no single in-app "all outbound off" switch today** (a gap worth closing — see below).
Ranked by speed / blast radius:

1. **Halt automated campaign + drip outbound — one statement, instant, reversible:**
   ```sql
   update comm_campaigns set status = 'paused' where status = 'active';
   ```
   `campaignDispatch()` skips non-active campaigns and `dripAdvance()` checks
   `camp.status === 'active'`, so this stops broadcasts **and** drips at the source. (Re-activate by
   restoring status.) Does **not** stop manual sends or inbound auto-replies.
2. **Halt AI-authored outbound** (workforce + AI auto-replies): flip the kill switch at
   `/super/ai/policies` (`gateway_enabled=false`) or set env `AI_GATEWAY_DISABLED=1`. **Does not
   stop template campaigns** (§3).
3. **Stop the scheduled driver:** remove/disable the `campaign-dispatch` cron in `vercel.json` and
   redeploy (slower than #1; only affects scheduled sends).
4. **Hard stop everything, including manual and inbound replies (nuclear):** rotate/blank the
   provider credentials (`TWILIO_AUTH_TOKEN` / `TWILIO_ACCOUNT_SID`, `RESEND_API_KEY`). Every
   provider call in `messaging.ts` then fails — no message leaves by any path. Most drastic;
   use only in an incident.

**Recommended incident play:** `#1` (pause active campaigns) + `#2` (AI kill switch) together halt
every *automated* path in seconds without a deploy; reserve `#4` for a true emergency.

> **Finding (backlog):** the fastest "halt everything" today is a manual SQL update or a credential
> pull — there is no first-class global comms pause. A `comm_policies.outbound_enabled` global gate
> checked at the top of `dispatch()` (mirroring the AI kill switch) would make this a one-click,
> audited action. Not part of D0; noted for a later hardening slice.

## 6. Relevance to D0

D0 builds the opt-out migration tooling and runs **dry-run by default against no live systems**, so
it does not itself send. But because the `campaign-dispatch` cron *is* live, the D0 rollout order
matters: migrate opt-outs into `consents`/`dnc_entries` (so the gate suppresses them) **before**
any further campaign activation, and keep the pause lever (§5 #1) ready during cutover.
