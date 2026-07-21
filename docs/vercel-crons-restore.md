# Vercel crons — Hobby stopgap & Pro restore

## Why this exists

Vercel's **Hobby** plan allows only **2 cron jobs, daily**. The FSOS background-jobs
spine (CLAUDE.md §6) needs **12** crons, several sub-daily. When the project is on
Hobby, a deploy with the full cron set is **rejected at config validation before the
build** — an instant failure with an empty preview URL and no build logs.

As a stopgap (owner-approved), `vercel.json` is trimmed to 2 daily crons so deploys
succeed on Hobby. **This disables 10 of the 12 scheduled jobs** — those API routes
still exist and can be triggered manually or by an external scheduler, but Vercel no
longer runs them automatically.

## Restore ALL 12 crons (do this after moving the project back to Pro)

On **Pro**, paste this `"crons"` array back into `vercel.json` (replacing the trimmed
one) and redeploy:

```json
"crons": [
  { "path": "/api/cron/renewal-watch", "schedule": "0 9 * * *" },
  { "path": "/api/cron/conversion-watch", "schedule": "0 9 * * *" },
  { "path": "/api/cron/xdate-watch", "schedule": "0 9 * * *" },
  { "path": "/api/cron/referral-sla", "schedule": "0 * * * *" },
  { "path": "/api/cron/agency-dormancy", "schedule": "0 10 * * *" },
  { "path": "/api/cron/cross-sell-scan", "schedule": "30 9 * * *" },
  { "path": "/api/cron/commission-reconcile", "schedule": "0 11 * * *" },
  { "path": "/api/cron/campaign-dispatch", "schedule": "*/30 * * * *" },
  { "path": "/api/cron/workforce-orchestrator", "schedule": "0 15 * * *" },
  { "path": "/api/cron/data-quality", "schedule": "0 6 * * *" },
  { "path": "/api/cron/backup-verify", "schedule": "0 3 * * *" },
  { "path": "/api/cron/workshop-reminders", "schedule": "*/15 * * * *" }
]
```

## Currently active on Hobby (the 2 kept)

- `/api/cron/renewal-watch` — daily 09:00 UTC (time-critical policy renewals)
- `/api/cron/campaign-dispatch` — daily 12:00 UTC (was every 30 min; now once/day)

## Disabled by the stopgap (10)

conversion-watch, xdate-watch, referral-sla, agency-dormancy, cross-sell-scan,
commission-reconcile, workforce-orchestrator, data-quality, backup-verify,
workshop-reminders.

> Preferred fix: restore the project to **Pro** and re-add all 12 crons above. The
> `functions` block (maxDuration 60) is within Hobby's limit; if a deploy still fails
> after this trim, the next suspect is build-minutes/billing, not the cron config.
