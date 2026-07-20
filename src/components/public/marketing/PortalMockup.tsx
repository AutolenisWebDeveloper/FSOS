import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * A crafted, on-brand preview of the practice's secure technology — used as the
 * hero and technology-section imagery. This is custom UI "imagery" (not a hotlinked
 * stock photo and not a fake screenshot): it mirrors the real product language —
 * navy shell, light card canvas, DM Mono numerics — so the marketing promise matches
 * the actual experience. It intentionally avoids any "client portal / login" framing.
 * Purely decorative (aria-hidden).
 */
export function PortalMockup({ className, withPhone = true }: { className?: string; withPhone?: boolean }) {
  return (
    <div aria-hidden className={cn('relative select-none', className)}>
      {/* Desktop browser frame */}
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-shell shadow-elev-xl ring-1 ring-black/5">
        {/* Title bar */}
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.03] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/25" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/20" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="mx-auto flex items-center gap-1.5 rounded-md bg-white/[0.06] px-3 py-1 text-[10px] font-medium text-shell-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400/80" /> markistfinancial.com
          </span>
        </div>
        <div className="flex">
          {/* Sidebar */}
          <div className="hidden w-[132px] shrink-0 flex-col gap-1 bg-white/[0.02] p-3 sm:flex">
            <div className="mb-2 flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-white">M</span>
              <span className="text-[11px] font-semibold text-white/90">Markist Financial</span>
            </div>
            {['Overview', 'Documents', 'Appointments', 'Messages', 'Reviews'].map((l, i) => (
              <div
                key={l}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 text-[10px]',
                  i === 0 ? 'bg-primary/25 font-semibold text-white' : 'text-shell-muted',
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', i === 0 ? 'bg-primary' : 'bg-white/25')} />
                {l}
              </div>
            ))}
          </div>
          {/* Content canvas */}
          <div className="flex-1 bg-background p-3.5">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[8px] font-medium uppercase tracking-widest text-primary">Welcome back</div>
                <div className="text-[13px] font-bold text-foreground">Good afternoon, Jordan</div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="rounded-full bg-status-won/15 px-2 py-0.5 text-[8px] font-semibold text-status-won">Secure</span>
                <span className="h-5 w-5 rounded-full bg-primary/15" />
              </div>
            </div>
            {/* Metric row */}
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { k: 'Coverage', v: '$1.25M', t: 'Active' },
                { k: 'Documents', v: '8', t: 'Shared' },
                { k: 'Next review', v: 'Aug 14', t: 'Scheduled' },
              ].map((m) => (
                <div key={m.k} className="rounded-lg border border-border bg-card p-2 shadow-elev-xs">
                  <div className="text-[7px] uppercase tracking-wide text-muted-foreground">{m.k}</div>
                  <div className="numeric mt-0.5 text-[13px] font-bold text-foreground">{m.v}</div>
                  <div className="text-[7px] text-status-won">{m.t}</div>
                </div>
              ))}
            </div>
            {/* Chart + list */}
            <div className="mt-2 grid grid-cols-5 gap-2">
              <div className="col-span-3 rounded-lg border border-border bg-card p-2 shadow-elev-xs">
                <div className="mb-1.5 text-[8px] font-semibold text-foreground">Plan progress</div>
                <div className="flex h-12 items-end gap-1">
                  {[38, 52, 44, 66, 58, 78, 72, 90].map((h, i) => (
                    <div key={i} className="flex-1 rounded-sm bg-primary/80" style={{ height: `${h}%`, opacity: 0.45 + i * 0.07 }} />
                  ))}
                </div>
              </div>
              <div className="col-span-2 flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2 shadow-elev-xs">
                <div className="text-[8px] font-semibold text-foreground">Recent activity</div>
                {['Document approved', 'Reminder sent', 'Review booked'].map((r) => (
                  <div key={r} className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    <span className="truncate text-[8px] text-muted-foreground">{r}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Phone overlay */}
      {withPhone ? (
        <div className="absolute -bottom-6 -right-3 hidden w-[118px] rotate-[3deg] overflow-hidden rounded-[1.4rem] border-[5px] border-shell bg-shell shadow-elev-xl sm:block md:-right-6 md:w-[132px]">
          <div className="bg-background p-2.5">
            <div className="text-[7px] font-medium uppercase tracking-widest text-primary">Secure workspace</div>
            <div className="text-[11px] font-bold text-foreground">Hello, Jordan</div>
            <div className="mt-2 rounded-lg brand-fill p-2 text-white shadow-elev-sm">
              <div className="text-[7px] uppercase tracking-wide text-white/70">Total coverage</div>
              <div className="numeric text-[13px] font-bold">$1,250,000</div>
            </div>
            <div className="mt-2 space-y-1.5">
              {['Upload a document', 'Book a review', 'Message Markist'].map((a) => (
                <div key={a} className="flex items-center justify-between rounded-md border border-border bg-card px-2 py-1.5">
                  <span className="text-[8px] font-medium text-foreground">{a}</span>
                  <span className="text-primary">›</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
