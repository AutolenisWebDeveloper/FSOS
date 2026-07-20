'use client'

import * as React from 'react'
import Link from 'next/link'
import { Menu, X, ChevronDown, LogIn, CalendarCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { FarmersLockup } from './FarmersLockup'
import { bookingUrl, loginUrl } from '@/lib/site'

type NavItem = { label: string; href: string; children?: { label: string; href: string; desc: string }[] }

const NAV: NavItem[] = [
  {
    label: 'Solutions',
    href: '#solutions',
    children: [
      { label: 'Life Insurance', href: '#solutions', desc: 'Term & permanent protection' },
      { label: 'Retirement Planning', href: '#solutions', desc: 'Income strategies for retirement' },
      { label: 'Investment Solutions', href: '#solutions', desc: 'Goals-aligned growth' },
      { label: 'Financial Reviews', href: '#solutions', desc: 'A clear look at where you stand' },
    ],
  },
  { label: 'Technology', href: '#technology' },
  { label: 'Resources', href: '#resources' },
  { label: 'About', href: '#about' },
  { label: 'Contact', href: '#contact' },
]

export function MarketingNav() {
  const [scrolled, setScrolled] = React.useState(false)
  const [mobileOpen, setMobileOpen] = React.useState(false)
  const [openMenu, setOpenMenu] = React.useState<string | null>(null)
  const book = bookingUrl()
  const login = loginUrl()

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Lock body scroll while the mobile sheet is open.
  React.useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // Close menus on Escape.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpenMenu(null)
        setMobileOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header
      className={cn(
        'sticky top-0 z-40 w-full border-b transition-[background,box-shadow,border-color] duration-300',
        scrolled ? 'border-border bg-white/95 shadow-elev-sm backdrop-blur-md' : 'border-transparent bg-white',
      )}
    >
      {/* Skip link — first focusable element. */}
      <a
        href="#main"
        className="sr-only rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50"
      >
        Skip to content
      </a>

      <nav aria-label="Primary" className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2" aria-label={`${'Markist Athelus'} — home`}>
          <FarmersLockup variant="light" />
        </Link>

        {/* Desktop links */}
        <ul className="hidden items-center gap-1 lg:flex">
          {NAV.map((item) =>
            item.children ? (
              <li
                key={item.label}
                className="relative"
                onMouseEnter={() => setOpenMenu(item.label)}
                onMouseLeave={() => setOpenMenu(null)}
              >
                <button
                  type="button"
                  aria-expanded={openMenu === item.label}
                  aria-haspopup="true"
                  onClick={() => setOpenMenu((v) => (v === item.label ? null : item.label))}
                  className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {item.label}
                  <ChevronDown className={cn('h-4 w-4 transition-transform', openMenu === item.label && 'rotate-180')} aria-hidden />
                </button>
                {openMenu === item.label ? (
                  <div className="absolute left-0 top-full w-72 pt-2">
                    <div className="overflow-hidden rounded-xl border border-border bg-card p-1.5 shadow-elev-lg">
                      {item.children.map((c) => (
                        <a
                          key={c.label}
                          href={c.href}
                          onClick={() => setOpenMenu(null)}
                          className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="block text-sm font-semibold text-foreground">{c.label}</span>
                          <span className="block text-xs text-muted-foreground">{c.desc}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </li>
            ) : (
              <li key={item.label}>
                <a
                  href={item.href}
                  className="inline-flex items-center rounded-md px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {item.label}
                </a>
              </li>
            ),
          )}
        </ul>

        {/* Desktop actions */}
        <div className="hidden items-center gap-2 lg:flex">
          <Button asChild variant="outline" size="sm">
            <a href={login}>
              <LogIn className="h-4 w-4" aria-hidden />
              Login
            </a>
          </Button>
          <Button asChild variant="destructive" size="sm">
            <a href={book} target={book.startsWith('http') ? '_blank' : undefined} rel="noopener">
              <CalendarCheck className="h-4 w-4" aria-hidden />
              Schedule Consultation
            </a>
          </Button>
        </div>

        {/* Mobile trigger */}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-foreground lg:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileOpen}
          aria-controls="mobile-menu"
          onClick={() => setMobileOpen((v) => !v)}
        >
          {mobileOpen ? <X className="h-6 w-6" aria-hidden /> : <Menu className="h-6 w-6" aria-hidden />}
        </button>
      </nav>

      {/* Mobile sheet */}
      {mobileOpen ? (
        <div id="mobile-menu" className="lg:hidden">
          <div className="border-t border-border bg-white px-5 pb-8 pt-3">
            <ul className="flex flex-col">
              {NAV.map((item) => (
                <li key={item.label}>
                  <a
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    className="block rounded-lg px-3 py-3 text-[15px] font-semibold text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {item.label}
                  </a>
                  {item.children ? (
                    <ul className="mb-1 ml-3 border-l border-border pl-3">
                      {item.children.map((c) => (
                        <li key={c.label}>
                          <a
                            href={c.href}
                            onClick={() => setMobileOpen(false)}
                            className="block rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            {c.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-4 grid grid-cols-1 gap-2">
              <Button asChild variant="outline" size="lg">
                <a href={login} onClick={() => setMobileOpen(false)}>
                  <LogIn className="h-4 w-4" aria-hidden />
                  Login
                </a>
              </Button>
              <Button asChild variant="destructive" size="lg">
                <a href={book} target={book.startsWith('http') ? '_blank' : undefined} rel="noopener" onClick={() => setMobileOpen(false)}>
                  <CalendarCheck className="h-4 w-4" aria-hidden />
                  Schedule Consultation
                </a>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
