import * as React from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MetricCard, type Tone } from '@/components/dashboards/primitives'
import {
  campaignStatus,
  enrollmentStatus,
  touchKind,
  approvalStatus,
  campaignTestHref,
  type CampaignEngine,
  type CampaignEngineKey,
} from '@/lib/comms/campaign-presentation'

/*
 * The shared campaign kit. Life Conversion, Cross-Sell Life, and Pipeline Win-Back
 * each grew their own copy of these, so the same information rendered differently on
 * every screen:
 *
 *   • The stat cell existed SIX times — `PhaseCell`, `FunnelCell`, `MiniCell` (×2
 *     divergent copies), and `Cell` (×2). All were a bordered box with a 2xl number
 *     over a small label, and all inverted the design-system order (MetricCard puts
 *     the mono label above the value). One tinted attention with `border-amber-400/60`
 *     — a raw Tailwind palette color, not a token.
 *   • The header actions were `<Link>` elements hand-styled to look like buttons
 *     (`rounded-md bg-primary px-3 py-1.5 …`), so they missed the button system's
 *     focus ring, disabled handling, and press feedback.
 *   • `Section` was redefined LOCALLY in two detail pages, shadowing the
 *     design-system `Section` (which carries the mono eyebrow) with a plain `<h2>`
 *     inside a Card.
 *
 * Everything here composes existing primitives. Server-Component-safe throughout —
 * no hooks, no event handlers, no 'use client'.
 */

// ─── Badges ───────────────────────────────────────────────────────────────────

export function CampaignStatusBadge({ status }: { status: string | null | undefined }) {
  const s = campaignStatus(status)
  return (
    <Badge variant={s.variant} title={s.description}>
      {s.label}
    </Badge>
  )
}

export function EnrollmentStatusBadge({ status }: { status: string | null | undefined }) {
  const s = enrollmentStatus(status)
  return (
    <Badge variant={s.variant} title={s.description}>
      {s.label}
    </Badge>
  )
}

export function TouchKindBadge({ kind }: { kind: string | null | undefined }) {
  const k = touchKind(kind)
  // Reads the variant off the vocabulary rather than hardcoding `outline`. Every touch
  // kind resolves to `outline` today, so this is currently equivalent — but hardcoding it
  // would mean a change to the shared vocabulary silently failed to reach this badge,
  // which is precisely the drift the shared layer exists to prevent.
  return (
    <Badge variant={k.variant} title={k.description}>
      {k.label}
    </Badge>
  )
}

/**
 * Approval state for a touch's template. `advisorTask` renders the em dash instead of
 * the "Missing" blocked chip, because an advisor-outreach touch is *supposed* to have
 * no template — without that distinction two of three schedules cried wolf on every
 * human touch.
 */
export function ApprovalBadge({ status, advisorTask = false }: { status: string | null | undefined; advisorTask?: boolean }) {
  if (advisorTask) return <span className="text-muted-foreground">—</span>
  const a = approvalStatus(status)
  return (
    <Badge variant={a.variant} title={a.description}>
      {a.label}
    </Badge>
  )
}

// ─── Stat cell ────────────────────────────────────────────────────────────────

/**
 * The one campaign stat cell, on the canonical `MetricCard`. `attentionWhenNonZero`
 * fires only when the value is non-zero, which is the convention every local copy
 * implemented by hand — a clean campaign shows a calm board.
 */
export function CampaignStat({
  label,
  value,
  hint,
  tone = 'neutral',
  attentionWhenNonZero = false,
  href,
}: {
  label: string
  value: number
  hint?: React.ReactNode
  tone?: Tone
  /** Tint `attention` only when there is something to act on. */
  attentionWhenNonZero?: boolean
  href?: string
}) {
  const resolved: Tone = attentionWhenNonZero ? (value > 0 ? 'attention' : 'neutral') : tone
  return <MetricCard label={label} value={value} hint={hint} tone={resolved} href={href} valueSize="md" />
}

/**
 * A funnel step — a stat plus its conversion rate against the previous stage. The
 * rate rides in `hint`, so it inherits the card's spacing instead of a bespoke line.
 */
export function FunnelStat({
  label,
  value,
  rate,
  rateLabel,
  tone = 'neutral',
}: {
  label: string
  value: number
  rate?: number
  rateLabel?: string
  tone?: Tone
}) {
  const hint = typeof rate === 'number' ? `${rate}% ${rateLabel ?? ''}`.trim() : undefined
  return <MetricCard label={label} value={value} hint={hint} tone={tone} valueSize="md" />
}

// ─── Header actions ───────────────────────────────────────────────────────────

/**
 * The action cluster every campaign header carries: state, the console test deep-link,
 * and the drill-in. Real `Button`s, so focus, hover, and
 * press behave like the rest of FSOS.
 */
export function CampaignHeaderActions({
  engine,
  status,
  version,
  manageHref,
  manageLabel = 'Open campaign',
}: {
  engine: CampaignEngine
  status: string
  /** Cross-Sell Life only — the versioned engine. */
  version?: number
  manageHref?: string
  manageLabel?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <CampaignStatusBadge status={status} />
      {typeof version === 'number' ? <Badge variant="outline" title="Campaign version">v{version}</Badge> : null}
      <Button variant="outline" size="sm" asChild>
        <Link href={campaignTestHref(engine)}>Test this campaign</Link>
      </Button>
      {manageHref ? (
        <Button size="sm" asChild>
          <Link href={manageHref}>{manageLabel}</Link>
        </Button>
      ) : null}
    </div>
  )
}

// ─── Cross-engine navigation ──────────────────────────────────────────────────

/**
 * Links the three engines to each other. Previously only Win-Back had a "Related"
 * rail, and it linked to Life Conversion but not Cross-Sell Life — so two of the
 * three campaigns were dead ends with no way to move between them.
 */
export function CampaignCrossLinks({ current, engines }: { current: CampaignEngineKey; engines: CampaignEngine[] }) {
  const others = engines.filter((e) => e.key !== current)
  if (others.length === 0) return null
  return (
    <nav aria-label="Other campaigns">
      <p className="mb-1.5 text-xs uppercase tracking-wide text-muted-foreground">Other campaigns</p>
      <ul className="space-y-1.5 text-sm">
        {others.map((e) => (
          <li key={e.key}>
            <Link className="text-primary underline-offset-4 hover:underline" href={e.href}>
              {e.title}
            </Link>
            <span className="ml-1.5 text-xs text-muted-foreground">
              {e.touches} touches · {e.days}d
            </span>
          </li>
        ))}
      </ul>
    </nav>
  )
}
