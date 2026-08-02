// src/app/schedule/loading.tsx
// Route-level loading state for /schedule (Definition of Done — skeleton, never a bare
// spinner). Mirrors the page's shell + card silhouette so the transition is calm and the
// layout doesn't shift when content arrives.
import { PublicPage } from '@/components/public/PublicShell'
import { PublicBrandHeader } from '@/components/public/booking/PublicBrandHeader'

export default function ScheduleLoading() {
  return (
    <PublicPage>
      <div className="w-full max-w-3xl">
        <PublicBrandHeader />
        <div className="animate-pulse space-y-6" aria-hidden>
          {/* Hero silhouette */}
          <div className="space-y-3">
            <div className="h-3 w-40 rounded bg-muted" />
            <div className="h-9 w-3/4 rounded-lg bg-muted" />
            <div className="h-4 w-2/3 rounded bg-muted" />
          </div>
          {/* Card silhouette */}
          <div className="overflow-hidden rounded-xl border border-border bg-card shadow-elev-md">
            <div className="shell-gradient h-16" />
            <div className="space-y-4 p-6 sm:p-8">
              <div className="h-5 w-48 rounded bg-muted" />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="h-20 rounded-lg bg-muted" />
                <div className="h-20 rounded-lg bg-muted" />
              </div>
            </div>
          </div>
        </div>
        <span className="sr-only" role="status">
          Loading the scheduling page
        </span>
      </div>
    </PublicPage>
  )
}
