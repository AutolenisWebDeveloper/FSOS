'use client'

import * as React from 'react'

/**
 * Blank-proof reveal enhancer. Content is fully visible by default (CSS ships no
 * hidden state); on mount this adds `.in` to each `.reveal`, staggered within its
 * group, to play the one-shot rise animation. No JS or reduced-motion = static and
 * visible — nothing is ever gated behind a scroll observer.
 */
export function SiteReveal() {
  React.useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('.msite .reveal'))
    const raf = requestAnimationFrame(() => {
      for (const el of nodes) {
        const parent = el.parentElement
        const group = parent ? Array.from(parent.querySelectorAll(':scope > .reveal')) : [el]
        const i = Math.max(0, group.indexOf(el))
        el.style.animationDelay = `${Math.min(i, 6) * 60}ms`
        el.classList.add('in')
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [])
  return null
}
