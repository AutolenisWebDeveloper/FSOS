'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

/*
 * A small, dependency-free overflow menu for the Contact Record. The app has no
 * dropdown primitive and adding one is outside this redesign's scope, so this is a
 * page-local button + popover following the ARIA menu-button pattern: the trigger
 * owns aria-haspopup/aria-expanded, opening moves focus onto the first item,
 * Up/Down rove, Escape closes and returns focus to the trigger, and an outside
 * click or Tab dismisses. Items are discovered from the DOM, so composition stays
 * free-form (separators, conditional items) with no index bookkeeping.
 */

const MenuContext = React.createContext<{ close: (focusTrigger?: boolean) => void } | null>(null)

export function ContactActionMenu({
  label = 'More actions',
  align = 'end',
  triggerClassName,
  trigger,
  children,
}: {
  label?: string
  align?: 'start' | 'end'
  triggerClassName?: string
  trigger: React.ReactNode
  children: React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuId = React.useId()

  const close = React.useCallback((focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const itemsOf = React.useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? []),
    [],
  )

  React.useEffect(() => {
    if (!open) return
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    const raf = requestAnimationFrame(() => itemsOf()[0]?.focus())
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
      cancelAnimationFrame(raf)
    }
  }, [open, close, itemsOf])

  function move(delta: 1 | -1) {
    const live = itemsOf()
    if (live.length === 0) return
    const current = live.findIndex((el) => el === document.activeElement)
    live[(current + delta + live.length) % live.length]?.focus()
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
        className={cn(
          'inline-flex h-9 w-9 items-center justify-center rounded-md border transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
          triggerClassName ??
            'border-shell-border/70 bg-shell-raised/60 text-shell-foreground hover:bg-shell-raised focus-visible:ring-accent focus-visible:ring-offset-shell',
        )}
      >
        {trigger}
      </button>
      {open ? (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              move(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              move(-1)
            } else if (e.key === 'Tab') {
              setOpen(false)
            }
          }}
          className={cn(
            'absolute z-50 mt-1.5 min-w-[14rem] animate-scale-in overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-2xl',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <MenuContext.Provider value={{ close }}>{children}</MenuContext.Provider>
        </div>
      ) : null}
    </div>
  )
}

export function ContactActionMenuItem({
  onSelect,
  children,
  destructive,
  disabled,
}: {
  onSelect: () => void
  children: React.ReactNode
  destructive?: boolean
  disabled?: boolean
}) {
  const ctx = React.useContext(MenuContext)
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      tabIndex={-1}
      onClick={() => {
        ctx?.close(false)
        onSelect()
      }}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-fast',
        'focus-visible:outline-none focus:bg-muted disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-muted-foreground',
        destructive
          ? 'text-destructive hover:bg-destructive/10 focus:bg-destructive/10 [&_svg]:text-destructive'
          : 'hover:bg-muted',
      )}
    >
      {children}
    </button>
  )
}

export function ContactActionMenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-border" />
}
