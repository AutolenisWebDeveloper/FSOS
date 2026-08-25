# Vercel crons — source of truth & plan requirements

## Single source of truth

`vercel.json` is the **authoritative, complete** cron set. Do NOT hand-maintain a
second list in this doc — an out-of-date copy here is how a "restore" can silently
**drop** live jobs. To see exactly what is scheduled, read `vercel.json`; to change
the schedule, edit `vercel.json` and redeploy. This file only explains the plan
constraints and how to verify execution.

As of the Phase-2 scheduler work, **all** background jobs are scheduled in
`vercel.json` — the detection jobs (FSOS-071), the AI workforce (FSOS-070), the
referral-SLA escalator (FSOS-071), the campaign-engine ticks/retries, and the
dedicated routes (`social-publish`, `booking-reminders`, `workshop-reminders`).
Every `/api/cron/<job>` path resolves through the dynamic dispatcher
(`src/app/api/cron/[job]/route.ts` → `JOBS` in `src/jobs/index.ts`) except the three
dedicated static routes, which have their own handlers; an unknown `[job]` key
fails closed with a 404. Cadence evidence for each job lives next to its schedule
here and in the job's handler comment.

## Plan requirement (LIVE — must be verified on the Vercel project)

Vercel's **Hobby** plan allows only **2 cron jobs, daily**; a deploy carrying more is
**rejected at config validation before the build** (instant failure, empty preview
URL, no build logs). The current `vercel.json` carries well beyond 2 sub-daily crons,
so the project **must be on Pro** (or a plan whose cron quota/cadence covers the full
set) for a deploy to succeed and for Vercel to actually invoke each schedule.

**This repository config is CONFIG-VERIFIED, not execution-verified.** Confirm on the
live project:

1. The project is on a plan whose cron quota ≥ the number of entries in `vercel.json`
   and whose minimum cadence permits the sub-daily entries (`*/5`, `*/15`, `30 * * * *`).
2. After deploy, the Vercel dashboard → **Cron Jobs** lists every entry.
3. Each job fires on schedule and its handler runs (observe the job's persisted
   evidence — tasks/activities/escalations, `outreach_queue` rows, audit rows, or the
   backup-verify heartbeat — and the `job_runs` idempotency ledger).

If a deploy still fails after confirming the plan, the next suspect is
build-minutes/billing, not the cron config. The per-route `maxDuration = 60` segment
exports (colocated in each long-running route, not a `vercel.json` `functions` block)
are within plan limits.

## Auth

Every `/api/cron/*` route authorizes on the Vercel Cron header (`x-vercel-cron`) OR a
`Bearer ${CRON_SECRET}` for manual/other triggers. Manual invocation therefore
requires `CRON_SECRET`.
