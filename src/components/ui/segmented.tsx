'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * FSOS segmented control — the canonical inline choice/tab switcher.
 *
 * Four surfaces had hand-rolled this out of bare `<button>` elements with copied
 * class strings (comms console ×2, compliance/consent, forms, contact notes). Two
 * problems that repeat wherever it was copied:
 *
 *  1. A11y. They set `role="tablist"`/`role="tab"` with no `aria-controls`, no
 *     `role="tabpanel"`, and no roving tabindex — so a keyboard user tabbed through
 *     every option one at a time and a screen reader announced a tab with nothing
 *     to control. WCAG 2.1 AA + the ARIA APG both want arrow-key navigation here.
 *  2. `type` was omitted, so dropping one inside a `<form>` submits it.
 *
 * Two honest semantics, because these are different controls:
 *
 *  • `mode="choice"` (default) — a radiogroup. The right answer when the buttons
 *    pick a VALUE (compose from blank vs. from a campaign). No panel required.
 *  • `mode="tabs"` — a real tablist. Requires `panelId`, which is wired to
 *    `aria-controls`; the panel must carry `role="tabpanel"` and `aria-labelledby`.
 *    Use `<SegmentedPanel>` and it is wired for you.
 *
 * Both follow the APG interaction model: one tab stop, Arrow keys move and select,
 * Home/End jump to the ends.
 */

export interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
  /** Optional trailing count/badge — kept subordinate so labels stay scannable. */
  hint?: React.ReactNode
  disabled?: boolean
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  mode = 'choice',
  panelId,
  size = 'default',
  className,
}: {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group. Required — an unlabeled group is unusable by ear. */
  label: string
  mode?: 'choice' | 'tabs'
  /** `mode="tabs"` only: the id of the panel this controls. */
  panelId?: string
  size?: 'sm' | 'default'
  className?: string
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([])
  const enabled = React.useMemo(() => options.filter((o) => !o.disabled), [options])

  const move = React.useCallback(
    (delta: 1 | -1 | 'first' | 'last') => {
      if (enabled.length === 0) return
      const currentIndex = enabled.findIndex((o) => o.value === value)
      let next: number
      if (delta === 'first') next = 0
      else if (delta === 'last') next = enabled.length - 1
      else {
        // Wrap, per the APG. -1 (current not found) + 1 lands on 0, which is correct.
        next = (currentIndex + delta + enabled.length) % enabled.length
      }
      const target = enabled[next]
      if (!target) return
      onChange(target.value)
      // Follow focus so the selection and the focus ring never diverge.
      const domIndex = options.findIndex((o) => o.value === target.value)
      refs.current[domIndex]?.focus()
    },
    [enabled, onChange, options, value],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'Home':
        e.preventDefault()
        move('first')
        break
      case 'End':
        e.preventDefault()
        move('last')
        break
    }
  }

  const isTabs = mode === 'tabs'

  return (
    <div
      role={isTabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        // A single recessed track with inset segments reads as one control, rather
        // than as loose buttons that happen to sit next to each other.
        'inline-flex items-center gap-1 rounded-lg border bg-sunken/60 p-1',
        className,
      )}
    >
      {options.map((option, i) => {
        const selected = option.value === value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role={isTabs ? 'tab' : 'radio'}
            id={isTabs && panelId ? `${panelId}-tab-${option.value}` : undefined}
            aria-selected={isTabs ? selected : undefined}
            aria-checked={isTabs ? undefined : selected}
            aria-controls={isTabs ? panelId : undefined}
            disabled={option.disabled}
            // Roving tabindex: the group is one tab stop; arrows move within it.
            tabIndex={selected ? 0 : -1}
            onClick={() => !option.disabled && onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background,color,box-shadow] duration-fast ease-standard',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              'disabled:pointer-events-none disabled:opacity-50',
              size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm',
              selected
                ? 'bg-card text-foreground shadow-xs ring-1 ring-inset ring-border'
                : 'text-muted-foreground hover:bg-card/60 hover:text-foreground',
            )}
          >
            {option.label}
            {option.hint != null ? (
              <span className={cn('numeric text-[11px]', selected ? 'text-muted-foreground' : 'text-muted-foreground/70')}>
                {option.hint}
              </span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/**
 * The panel half of `mode="tabs"`. Carries the roles the hand-rolled versions were
 * missing, so the tab actually controls something announceable.
 */
export function SegmentedPanel({
  id,
  activeValue,
  children,
  className,
}: {
  id: string
  /** The currently selected option — used to point `aria-labelledby` at its tab. */
  activeValue: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div id={id} role="tabpanel" aria-labelledby={`${id}-tab-${activeValue}`} tabIndex={0} className={cn('focus-visible:outline-none', className)}>
      {children}
    </div>
  )
}
