'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Professional headshot with a graceful fallback. When an approved photo is
 * dropped at `public/brand/markist.jpg`, it renders; until then (or if it fails
 * to load) a branded monogram panel shows instead — so the section never displays
 * a broken image. `next/image` is intentionally avoided to keep the asset optional
 * without remote-pattern config.
 */
export function Portrait({ className, alt }: { className?: string; alt: string }) {
  const [failed, setFailed] = React.useState(false)
  return (
    <div className={cn('relative aspect-[4/5] w-full overflow-hidden rounded-2xl bg-shell shadow-elev-lg', className)}>
      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src="/brand/markist.jpg"
          alt={alt}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover object-top"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-full w-full flex-col items-center justify-center shell-gradient text-center"
        >
          <span className="flex h-24 w-24 items-center justify-center rounded-3xl bg-primary/20 text-4xl font-bold text-white ring-1 ring-inset ring-white/15">
            MA
          </span>
          <span className="mt-4 text-lg font-semibold text-white">Markist Athelus</span>
          <span className="mt-1 text-xs text-shell-muted">Farmers Financial Services Agent</span>
        </div>
      )}
      {/* Subtle brand keyline at the base. */}
      <span aria-hidden className="absolute inset-x-0 bottom-0 h-1 bg-destructive" />
    </div>
  )
}
