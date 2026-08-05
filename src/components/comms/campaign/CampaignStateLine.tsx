import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { campaignState, type CampaignStateInput } from '@/lib/comms/campaign-state'

/*
 * The campaign state line — one sentence, directly under the page header, answering the
 * question an advisor actually arrives with: is this campaign OK right now?
 *
 * It replaces no existing element; it removes work. The facts that determine whether a
 * campaign is doing its job were scattered across four sections — approval state in
 * assets, simulation state in controls, dead-lettered sends in analytics, enrollment
 * counts in the KPI row — so the answer existed only in the reader's head. A campaign
 * could read "Active" in the header while every one of its templates sat in draft, and
 * nothing on the screen connected those two facts.
 *
 * All logic lives in @/lib/comms/campaign-state as a pure function, so the wording and
 * the severity rules are unit-tested rather than eyeballed.
 */

const TONE_SHELL: Record<string, string> = {
  live: 'border-border bg-card',
  preparing: 'border-border bg-card',
  held: 'border-status-pending/40 bg-status-pending/[0.06]',
  stopped: 'border-status-blocked/40 bg-status-blocked/[0.06]',
}

export function CampaignStateLine(props: CampaignStateInput & { className?: string }) {
  const { className, ...input } = props
  const state = campaignState(input)
  const hasBlockers = state.blockers.length > 0

  return (
    <section
      aria-label="Campaign state"
      className={cn(
        'rounded-xl border p-4 shadow-elev-xs',
        // A blocker outranks lifecycle tone: a live campaign that cannot dispatch needs
        // to read as needing attention, not as calmly running. `gold` is the design
        // system's attention token (never success), same as MetricCard's attention tone.
        hasBlockers ? 'border-gold/45 bg-gradient-to-b from-gold/[0.06] to-transparent' : TONE_SHELL[state.tone],
        className,
      )}
    >
      <p className={cn('text-sm font-medium', hasBlockers && 'text-gold-deep')}>{state.headline}</p>

      {hasBlockers ? (
        <ul className="mt-2.5 space-y-1.5">
          {state.blockers.map((b) => (
            <li key={b.key} className="flex flex-wrap items-baseline gap-x-2 text-sm text-foreground">
              <span aria-hidden className="text-gold-deep">
                •
              </span>
              <span className="flex-1">
                {b.text}
                {b.href ? (
                  <>
                    {' '}
                    <Link
                      href={b.href}
                      className="whitespace-nowrap text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {b.hrefLabel ?? 'Open'}
                    </Link>
                  </>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      {state.notes.length > 0 ? (
        <ul className={cn('space-y-1', hasBlockers ? 'mt-2.5 border-t pt-2.5' : 'mt-2')}>
          {state.notes.map((n) => (
            <li key={n.key} className="text-xs text-muted-foreground">
              {n.text}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
