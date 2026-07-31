import Link from 'next/link'
import { ArrowRight, Sparkles } from 'lucide-react'
import { MonoLabel } from '@/components/ui/typography'
import { portalWorkspaces } from '@/lib/workspaces/registry'
import { resolveIcon } from '@/lib/workspaces/icons'

// Launch Workspace — a curated set of the FSA's daily-use workspaces, generated
// from the Workspace Registry (no hardcoded nav; the rail owns the full set). The
// order below is the advisor's most-common entry points, front to back.
const FEATURED = [
  'households', 'opportunities', 'cases', 'reviews',
  'communications', 'cross-sell', 'commissions', 'fna',
  'ai-workforce', 'social',
]

export function WorkspaceLauncher() {
  const byId = new Map(portalWorkspaces('fsa').map((w) => [w.id, w]))
  const items = FEATURED.map((id) => byId.get(id)).filter((w): w is NonNullable<typeof w> => Boolean(w))
  // Titled region, not a card — the tiles are the cards (no nesting).
  return (
    <section aria-label="Launch workspace" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <MonoLabel className="text-muted-foreground">Launch workspace</MonoLabel>
        <Link href="/app/dashboards" className="text-sm font-medium text-primary transition-colors duration-fast hover:text-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
          Customize
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-5">
        {items.map((wksp) => {
          const Icon = resolveIcon(wksp.icon)
          return (
            <Link
              key={wksp.id}
              href={wksp.home}
              className="group flex flex-col gap-2 rounded-xl border border-border/70 bg-card p-3 transition-all duration-base ease-standard hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-elev-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className={wksp.ai ? 'ai-surface flex h-9 w-9 items-center justify-center rounded-lg' : 'flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary'} aria-hidden>
                <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                  {wksp.label}
                  {wksp.ai ? <Sparkles className="h-3 w-3 shrink-0 text-ai" strokeWidth={2} aria-hidden /> : null}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">{wksp.description}</p>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
