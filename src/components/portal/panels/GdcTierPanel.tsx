import Link from 'next/link'
import type { GdcTierState } from '@/lib/data/gdc'

const fmt = (n: number) => `$${Math.round(Number(n || 0)).toLocaleString('en-US')}`

// Sidebar CURRENT GDC TIER card (design-system.md §5.3B) — the signature gold panel,
// wired to real rolling-12mo production + assumption-flagged tier config. Renders
// nothing until tiers are configured (never a broken/empty box). The FSA layout
// loads `state` via loadGdcTierState().
export function GdcTierPanel({ state }: { state: GdcTierState | null }) {
  if (!state || !state.math.current) return null
  const t = state.math.current
  const next = state.math.next

  return (
    <section aria-label="Current GDC tier" className="space-y-1.5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">Current GDC Tier</h2>
      <Link
        href="/app/commissions/gdc"
        className="block rounded-lg border border-status-assumption/40 bg-status-assumption/5 p-3 transition-colors hover:border-status-assumption/60"
      >
        <div className="text-lg font-semibold text-status-assumption">
          {t.label} — {t.payout_pct}%
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">{fmt(state.rolling12)} rolling-12mo GDC</p>
        {next ? (
          <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
            {fmt(state.math.distanceToNext)} to {next.label}
          </p>
        ) : null}
        <span className="mt-2 inline-block rounded border border-status-assumption/40 bg-status-assumption/10 px-1.5 py-0.5 font-mono text-[0.625rem] uppercase tracking-wide text-status-assumption">
          config default — verify
        </span>
      </Link>
    </section>
  )
}
