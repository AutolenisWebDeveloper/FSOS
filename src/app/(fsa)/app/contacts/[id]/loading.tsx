import { Skeleton } from '@/components/ui/skeleton'

/*
 * Route-level loading state for the Contact Record. It mirrors the real
 * composition — dark identity band, attention gap, section nav, snapshot strip,
 * two-column workspace, reference rail — so the page does not reflow when the
 * data lands.
 */
export default function ContactDetailLoading() {
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading contact…</span>
      <div
        aria-hidden
        className="shell-gradient shell-hairline -mx-4 -mt-6 border-b border-shell-border px-4 pb-3 pt-4 shadow-elev-md md:-mx-6 md:px-6"
      >
        <div className="mx-auto max-w-[1600px]">
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-56 bg-white/10" />
            <Skeleton className="h-9 w-72 bg-white/10" />
          </div>
          <div className="mt-3.5 flex items-start gap-4">
            <Skeleton className="h-[52px] w-[52px] rounded-xl bg-white/10" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-7 w-72 bg-white/10" />
              <Skeleton className="h-4 w-96 max-w-full bg-white/10" />
            </div>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-6 border-t border-shell-border/70 pt-3.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-2.5 w-20 bg-white/10" />
                <Skeleton className="h-3.5 w-32 bg-white/10" />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div aria-hidden className="mx-auto max-w-[1600px] lg:flex lg:items-start lg:gap-6 xl:gap-8">
        <div className="min-w-0 space-y-5 lg:flex-1">
          <Skeleton className="h-10 w-full max-w-lg" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
            <div className="space-y-3">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-40 w-full rounded-xl" />
            </div>
          </div>
        </div>
        <div className="mt-5 w-full shrink-0 lg:mt-0 lg:w-[19rem] xl:w-[21rem]">
          <Skeleton className="h-[26rem] w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
}
