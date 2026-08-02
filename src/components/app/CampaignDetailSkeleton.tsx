import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'

// Content-matched loading skeleton for the campaign engine DETAIL pages (Life Conversion,
// Pipeline Win-Back, Cross-Sell Life). Mirrors the real layout — a summary stat-tile row, the
// operational-controls card, and two analytics sections — so the pending state reads as the page
// filling in, not a bare spinner (§13.1/§21). A composition of the existing Skeleton primitive; not
// a new design-system pattern. One aria-busy status region names the whole load for screen readers.
export function CampaignDetailSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading campaign details…</span>
      <div aria-hidden className="space-y-6">
        {/* Summary stat tiles */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="p-5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-7 w-16" />
            </Card>
          ))}
        </div>
        {/* Operational controls */}
        <Card className="p-5 space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-36" />
          </div>
        </Card>
        {/* Two analytics sections */}
        <div className="grid gap-4 lg:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Card key={i} className="p-5 space-y-3">
              <Skeleton className="h-4 w-48" />
              <div className="grid grid-cols-3 gap-3">
                {Array.from({ length: 3 }).map((_, j) => (
                  <Skeleton key={j} className="h-16 w-full" />
                ))}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
