'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Entrance animation that can NEVER leave content blank. The default (SSR / no-JS
 * / reduced-motion) state is fully visible — the "hidden" state is applied only by
 * JS after mount, then released on the next frame, with a timer fallback so even a
 * throttled background tab (where rAF pauses but timers still fire) always resolves
 * to visible. This deliberately avoids gating visibility on a scroll observer,
 * which strands below-fold content blank in headless/prerender captures.
 */
export function Reveal({
  children,
  as: Tag = 'div',
  delay = 0,
  className,
}: {
  children: React.ReactNode
  as?: 'div' | 'section' | 'li' | 'article'
  delay?: number
  className?: string
}) {
  // 'pre' = untouched, visible (what SSR renders). JS drives hidden → shown.
  const [state, setState] = React.useState<'pre' | 'hidden' | 'shown'>('pre')

  React.useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return // stay visible, no motion
    setState('hidden')
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setState('shown')))
    const t = window.setTimeout(() => setState('shown'), 260 + delay) // bg-tab safety
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [delay])

  return (
    <Tag
      style={state !== 'pre' ? { transitionDelay: `${delay}ms` } : undefined}
      className={cn(
        state === 'hidden' && 'translate-y-3 opacity-0',
        state === 'shown' &&
          'translate-y-0 opacity-100 transition-[opacity,transform] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
