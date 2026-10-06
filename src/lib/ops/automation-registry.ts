// src/lib/ops/automation-registry.ts
// The registry of every automation FSOS PRESENTS — scheduled jobs, event consumers, and the
// catalogues the UI shows but nothing executes. It exists to close the #265 failure class: a
// surface that describes automation ("these fire on events", an Enable toggle, a cadence) with no
// runtime path behind it. tests/automation-wiring.test.mjs holds the registry against the real
// wiring (vercel.json, JOBS, the cron routes, the consumer files) and holds every `reference`
// entry's UI to the REFERENCE_COPY_LABEL marker, so a new display-only catalogue cannot ship
// looking like a live automation.
//
// Pure data; no imports beyond types. Read by the wiring guard and the status read model.

import type { AutomationSwitchKey } from './automation-switch'

/** The exact label every reference-only catalogue must show (asserted by the wiring guard). */
export const REFERENCE_COPY_LABEL = 'Reference copy — not dispatched'

export type AutomationTrigger =
  /** A Vercel cron entry → /api/cron/[job] → JOBS[job]. */
  | { kind: 'cron'; job: string }
  /** A Vercel cron entry → its own static /api/cron/<route> handler. */
  | { kind: 'cron_route'; route: string }
  /** An inbound provider/webhook route. */
  | { kind: 'webhook'; route: string }
  /** Only an operator action starts it. */
  | { kind: 'manual'; route: string }
  /** Nothing starts it — the UI shows it as reference only. */
  | { kind: 'none' }

export interface AutomationEntry {
  key: string
  label: string
  /** The surface that presents it (route path, for the report and the status page). */
  ui: string
  trigger: AutomationTrigger
  /** The module that does the work, and the export that is invoked. Null for reference entries. */
  consumer: { file: string; export: string } | null
  /** Display-only catalogue: the `uiFile` must render REFERENCE_COPY_LABEL. */
  reference?: { uiFile: string }
  /** An off/canary/on switch gating a consumer this audit connected (src/lib/ops/automation-switch.ts). */
  switch?: AutomationSwitchKey
  /**
   * Run cadence of a scheduled entry; held against vercel.json by the wiring guard. Default daily.
   * 'hourly_window' = every hour inside a range of hours (e.g. `0 17-23 * * *`, finding 5).
   */
  cadence?: 'daily' | 'hourly' | 'hourly_window' | 'sub_hourly'
}

const H = 'src/jobs/handlers.ts'
const cron = (key: string, label: string, ui: string, exp: string, cadence: AutomationEntry['cadence'] = 'daily'): AutomationEntry => ({
  key,
  label,
  ui,
  trigger: { kind: 'cron', job: key },
  consumer: { file: H, export: exp },
  cadence,
})

export const AUTOMATIONS: readonly AutomationEntry[] = [
  // ── Scheduled jobs (/api/cron/[job]) ──
  cron('renewal-watch', 'Renewal review tasks', '/app/tasks', 'renewalWatch'),
  cron('conversion-watch', 'Conversion detection signals', '/app/conversions/monitoring', 'conversionWatch'),
  cron('xdate-watch', 'X-date outreach tasks', '/app/tasks', 'xdateWatch'),
  cron('referral-sla', 'Referral SLA watch', '/app/referrals', 'referralSla', 'hourly'),
  cron('agency-dormancy', 'Agency dormancy watch', '/app/agencies', 'agencyDormancy'),
  cron('cross-sell-scan', 'Cross-sell detection', '/app/cross-sell', 'crossSellScan'),
  cron('commission-reconcile', 'Commission reconciliation', '/app/commissions', 'commissionReconcile'),
  cron('campaign-dispatch', 'Broadcast campaigns + drips', '/app/comms/campaigns', 'campaignDispatch', 'hourly_window'),
  cron('resume-paused', 'Resume paused enrollments', '/app/comms/campaigns', 'resumePausedEnrollments'),
  cron('workforce-orchestrator', 'AI workforce', '/app/ai', 'workforceOrchestrator'),
  cron('data-quality', 'Data quality reconcile', '/super/jobs', 'dataQuality'),
  cron('life-conversion-tick', 'Life Conversion campaign', '/app/comms/life-conversion', 'lifeConversionTick', 'hourly_window'),
  { ...cron('life-conversion-retry', 'Life Conversion retry sweep', '/app/comms/life-conversion', 'lifeConversionRetry', 'hourly'), switch: 'engine_retry_redispatch' },
  cron('pipeline-winback-tick', 'Pipeline Win-Back campaign', '/app/comms/pipeline-winback', 'pipelineWinbackTick', 'hourly_window'),
  { ...cron('pipeline-winback-retry', 'Pipeline Win-Back retry sweep', '/app/comms/pipeline-winback', 'pipelineWinbackRetry', 'hourly'), switch: 'engine_retry_redispatch' },
  cron('cross-sell-life-enroll', 'Cross-Sell Life enrollment', '/app/comms/cross-sell-life', 'crossSellLifeEnroll'),
  cron('cross-sell-life-tick', 'Cross-Sell Life campaign', '/app/comms/cross-sell-life', 'crossSellLifeTick', 'hourly_window'),
  { ...cron('cross-sell-life-retry', 'Cross-Sell Life retry sweep', '/app/comms/cross-sell-life', 'crossSellLifeRetry', 'hourly'), switch: 'engine_retry_redispatch' },
  cron('district-nurture-tick', 'District nurture', '/app/comms/district-nurture', 'districtNurtureTick', 'hourly_window'),
  { ...cron('district-nurture-retry', 'District nurture retry sweep', '/app/comms/district-nurture', 'districtNurtureRetry', 'hourly'), switch: 'engine_retry_redispatch' },
  cron('backup-verify', 'Backup verification', '/super/backups', 'backupVerify'),

  // ── Scheduled jobs with their own route ──
  {
    key: 'booking-reminders',
    label: 'Appointment reminders + notice retry',
    ui: '/app/booking',
    trigger: { kind: 'cron_route', route: 'booking-reminders' },
    cadence: 'sub_hourly',
    consumer: { file: 'src/lib/booking/notify.ts', export: 'runBookingReminderPass' },
  },
  {
    key: 'social-publish',
    label: 'Social publishing',
    ui: '/app/social',
    trigger: { kind: 'cron_route', route: 'social-publish' },
    cadence: 'sub_hourly',
    consumer: { file: 'src/lib/social/publisher.ts', export: 'publishDueEntries' },
  },
  {
    key: 'workshop-reminders',
    label: 'Workshop reminders, change notices, nurture',
    ui: '/app/workshops',
    trigger: { kind: 'cron_route', route: 'workshop-reminders' },
    cadence: 'sub_hourly',
    consumer: { file: 'src/lib/workshops/comms-engine.ts', export: 'runReminderPass' },
  },

  // ── Event consumers ──
  {
    key: 'twilio-status',
    label: 'SMS delivery status + carrier opt-out',
    ui: '/app/comms/delivery',
    trigger: { kind: 'webhook', route: 'src/app/api/webhooks/twilio/status/route.ts' },
    consumer: { file: 'src/lib/comms/opt-out.ts', export: 'recordCarrierOptOut' },
    // No switch: a carrier opt-out only ever STOPS sends (follow-up R13).
  },
  {
    key: 'inbound-sms',
    label: 'Inbound SMS (STOP / START / HELP / replies)',
    ui: '/app/comms/sms',
    trigger: { kind: 'webhook', route: 'src/app/api/webhooks/twilio/inbound/route.ts' },
    consumer: { file: 'src/lib/comms/inbound.ts', export: 'processInbound' },
  },
  {
    key: 'resend-events',
    label: 'Email delivery events + bounce/complaint suppression',
    ui: '/app/comms/delivery',
    trigger: { kind: 'webhook', route: 'src/app/api/webhooks/resend/route.ts' },
    consumer: { file: 'src/lib/comms/deliverability.ts', export: 'applyDeliverabilitySuppression' },
  },

  // ── Catalogues the UI shows but nothing executes (#265 class) ──
  {
    key: 'winback-event-driven-sms',
    label: 'Win-Back event-driven SMS catalogue',
    ui: '/app/comms/pipeline-winback/[id]',
    trigger: { kind: 'none' },
    consumer: null,
    reference: { uiFile: 'src/app/(fsa)/app/comms/pipeline-winback/[id]/page.tsx' },
  },
  ...(
    [
      ['pipeline-winback', 'Win-Back'],
      ['cross-sell-life', 'Cross-Sell Life'],
      ['life-conversion', 'Life Conversion'],
    ] as const
  ).map(([slug, name]): AutomationEntry => ({
    key: `${slug}-playbooks`,
    label: `${name} AI conversation playbooks (follow-up, handoff, closing)`,
    ui: `/app/comms/${slug}/[id]`,
    trigger: { kind: 'none' },
    consumer: null,
    reference: { uiFile: `src/app/(fsa)/app/comms/${slug}/[id]/page.tsx` },
  })),
  {
    key: 'workflow-builder',
    label: 'Automation workflows builder',
    ui: '/app/workflows',
    trigger: { kind: 'none' },
    consumer: null,
    reference: { uiFile: 'src/app/(fsa)/app/workflows/page.tsx' },
  },
]

/**
 * JOBS keys that are deliberately NOT scheduled because they alias a scheduled job (a manual or
 * legacy entry point onto the same handler). Anything else unscheduled is an orphan.
 */
export const JOB_ALIASES: Readonly<Record<string, string>> = {
  'agent-runner': 'workforce-orchestrator',
}

/** Lookup by key. */
export function automationByKey(key: string): AutomationEntry | undefined {
  return AUTOMATIONS.find((a) => a.key === key)
}
