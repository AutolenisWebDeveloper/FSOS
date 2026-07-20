import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * Marketing section primitives. `Section` gives a consistent max width + fluid
 * vertical rhythm; `SectionIntro` is a reusable heading block. A `kicker` is
 * available but used sparingly (a few key sections), never as an every-section
 * eyebrow.
 */
export function Section({
  id,
  children,
  className,
  tone = 'canvas',
  bleed = false,
}: {
  id?: string
  children: React.ReactNode
  className?: string
  /** Surface tone for the band. */
  tone?: 'canvas' | 'sunken' | 'shell' | 'white'
  /** When true, the band background bleeds full-width and children set their own container. */
  bleed?: boolean
}) {
  const toneClass =
    tone === 'shell'
      ? 'shell-gradient text-shell-foreground'
      : tone === 'sunken'
        ? 'bg-sunken'
        : tone === 'white'
          ? 'bg-card'
          : 'bg-background'
  return (
    <section
      id={id}
      className={cn('relative scroll-mt-24', toneClass, className)}
      // Fluid section padding — breathes on large viewports, tightens on mobile.
      style={{ paddingBlock: 'clamp(3.5rem, 7vw, 7rem)' }}
    >
      {bleed ? children : <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">{children}</div>}
    </section>
  )
}

export function Kicker({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn('mono-label text-primary', className)}>{children}</p>
}

export function SectionIntro({
  kicker,
  title,
  lead,
  align = 'left',
  onDark = false,
  className,
}: {
  kicker?: React.ReactNode
  title: React.ReactNode
  lead?: React.ReactNode
  align?: 'left' | 'center'
  onDark?: boolean
  className?: string
}) {
  return (
    <div className={cn(align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-2xl', className)}>
      {kicker ? <Kicker className={cn('mb-3', onDark && 'text-shell-highlight')}>{kicker}</Kicker> : null}
      <h2
        className={cn(
          'text-pretty font-bold tracking-[-0.02em] text-balance',
          onDark ? 'text-white' : 'text-foreground',
        )}
        style={{ fontSize: 'clamp(1.7rem, 3.4vw, 2.6rem)', lineHeight: 1.08 }}
      >
        {title}
      </h2>
      {lead ? (
        <p
          className={cn(
            'mt-4 text-[1.05rem] leading-relaxed',
            onDark ? 'text-shell-foreground/85' : 'text-muted-foreground',
          )}
        >
          {lead}
        </p>
      ) : null}
    </div>
  )
}
