import * as React from 'react'
import Link from 'next/link'
import { Phone, Mail, MapPin } from 'lucide-react'
import { FarmersLockup } from './FarmersLockup'
import { BUSINESS, CONTACT, DISCLOSURES, LICENSING, SOCIAL, loginUrl } from '@/lib/site'

const COLS: { heading: string; links: { label: string; href: string }[] }[] = [
  {
    heading: 'Solutions',
    links: [
      { label: 'Life Insurance', href: '/#solutions' },
      { label: 'Retirement Planning', href: '/#solutions' },
      { label: 'Investment Solutions', href: '/#solutions' },
      { label: 'Annuities', href: '/#solutions' },
      { label: 'Business Protection', href: '/#solutions' },
      { label: 'Financial Reviews', href: '/#solutions' },
    ],
  },
  {
    heading: 'Explore',
    links: [
      { label: 'About Markist', href: '/#about' },
      { label: 'Technology', href: '/#technology' },
      { label: 'Resources & FAQ', href: '/#resources' },
      { label: 'Workshops', href: '/events' },
      { label: 'Contact', href: '/#contact' },
      { label: 'Login', href: loginUrl() },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { label: 'Privacy Policy', href: '/privacy' },
      { label: 'Terms of Use', href: '/terms' },
      { label: 'SMS Terms & Conditions', href: '/sms-terms' },
      { label: 'Accessibility', href: '/accessibility' },
      { label: 'Disclosures', href: '/disclosures' },
      { label: 'Do Not Contact / Opt-Out', href: '/unsubscribe' },
    ],
  },
]

export function MarketingFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="shell-gradient text-shell-foreground">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand + contact */}
          <div>
            <FarmersLockup variant="dark" />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-shell-foreground/75">
              Personalized insurance and financial strategies to help you protect what matters most and build a
              confident future.
            </p>
            <ul className="mt-5 space-y-2.5 text-sm">
              <li className="flex items-center gap-2.5 text-shell-foreground/85">
                <Phone className="h-4 w-4 text-[hsl(210_90%_72%)]" aria-hidden />
                <a href={`tel:${CONTACT.phoneE164}`} className="underline-offset-2 hover:text-white hover:underline">
                  {CONTACT.phoneDisplay}
                </a>
              </li>
              <li className="flex items-center gap-2.5 text-shell-foreground/85">
                <Mail className="h-4 w-4 text-[hsl(210_90%_72%)]" aria-hidden />
                <a href={`mailto:${CONTACT.email}`} className="underline-offset-2 hover:text-white hover:underline">
                  {CONTACT.email}
                </a>
              </li>
              <li className="flex items-start gap-2.5 text-shell-foreground/85">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-[hsl(210_90%_72%)]" aria-hidden />
                <span>
                  {CONTACT.address.line1}, {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal}
                </span>
              </li>
            </ul>
          </div>

          {/* Link columns */}
          {COLS.map((col) => (
            <nav key={col.heading} aria-label={col.heading}>
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-shell-muted">{col.heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-sm text-shell-foreground/80 underline-offset-4 transition-colors hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 rounded"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {SOCIAL.length > 0 ? (
          <div className="mt-10 flex gap-3">
            {SOCIAL.map((s) => (
              <a
                key={s.href}
                href={s.href}
                target="_blank"
                rel="noopener"
                className="rounded-md px-2 py-1 text-sm text-shell-foreground/80 hover:text-white"
              >
                {s.label}
              </a>
            ))}
          </div>
        ) : null}

        {/* Disclosures */}
        <div className="mt-12 space-y-3 border-t border-white/10 pt-8 text-[12.5px] leading-relaxed text-shell-foreground/65">
          <p>
            {BUSINESS.agent}, {BUSINESS.title}. {LICENSING}.
          </p>
          <p>{DISCLOSURES.securities}</p>
          <p>{DISCLOSURES.life}</p>
          <p>{DISCLOSURES.advice}</p>
          <p>{DISCLOSURES.notFarmers}</p>
        </div>

        <div className="mt-8 flex flex-col items-start justify-between gap-3 border-t border-white/10 pt-6 text-xs text-shell-muted sm:flex-row sm:items-center">
          <p>
            © {year} {BUSINESS.agent}. All rights reserved.
          </p>
          <p className="text-shell-foreground/60">Securities offered through Farmers Financial Solutions, LLC · Member FINRA &amp; SIPC</p>
        </div>
      </div>
    </footer>
  )
}
