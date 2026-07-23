'use client'

import * as React from 'react'
import Link from 'next/link'
import { Icon, BrandLogo } from './icons'
import { BUSINESS, CONTACT, bookingUrl, loginUrl } from '@/lib/site'

const SOLUTIONS = [
  'Life Insurance',
  'Retirement Planning',
  'College Planning',
  'Investments',
  'Annuities',
  'Business Protection',
]

export function SiteHeader({ active = 'home' }: { active?: 'home' | 'services' | 'about' | 'faq' | 'contact' | 'workshops' | 'none' }) {
  const [open, setOpen] = React.useState(false)
  const book = bookingUrl()
  const login = loginUrl()
  const bookExternal = book.startsWith('http')

  return (
    <>
      {/* Utility topbar */}
      <div className="util">
        <div className="shell util__in">
          <div className="util__l">
            <a className="util__item" href={`tel:${CONTACT.phoneE164}`}>
              <Icon name="phone" />
              {CONTACT.phoneDisplay}
            </a>
            <a className="util__item" href={`mailto:${CONTACT.email}`}>
              <Icon name="mail" />
              {CONTACT.email}
            </a>
            <span className="util__item">
              <Icon name="pin" />
              {CONTACT.address.city}, {CONTACT.address.region} {CONTACT.address.postal}
            </span>
          </div>
          <span className="util__r">
            <Icon name="shield" />
            Licensed in TX &amp; more
          </span>
        </div>
      </div>

      {/* Header / nav */}
      <header className="head">
        <div className="shell head__in">
          <Link className="brand" href="/" aria-label={`${BUSINESS.agent} — home`}>
            <BrandLogo />
            <span className="brand__txt">
              <strong>{BUSINESS.agent}</strong>
              <span>
                {BUSINESS.title} · {BUSINESS.carrier}
              </span>
            </span>
          </Link>
          <nav className={`nav${open ? ' open' : ''}`} aria-label="Main">
            <button
              className="burger"
              aria-expanded={open}
              aria-controls="site-navlinks"
              aria-label={open ? 'Close menu' : 'Open menu'}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name="menu" />
            </button>
            <ul className="nav__links" id="site-navlinks">
              <li>
                <Link href="/" aria-current={active === 'home' ? 'page' : undefined}>
                  Home
                </Link>
              </li>
              <li>
                <Link href="/services" aria-current={active === 'services' ? 'page' : undefined}>
                  Services
                  <Icon name="caret" className="caret" />
                </Link>
                <div className="menu">
                  {SOLUTIONS.map((s) => (
                    <Link key={s} href={`/services#${s.toLowerCase().replace(/\s+/g, '-')}`} onClick={() => setOpen(false)}>
                      {s}
                    </Link>
                  ))}
                </div>
              </li>
              <li>
                <Link href="/workshops" aria-current={active === 'workshops' ? 'page' : undefined}>
                  Workshops
                </Link>
              </li>
              <li>
                <Link href="/about" aria-current={active === 'about' ? 'page' : undefined}>
                  About
                </Link>
              </li>
              <li>
                <Link href="/faq" aria-current={active === 'faq' ? 'page' : undefined}>
                  Resources
                  <Icon name="caret" className="caret" />
                </Link>
                <div className="menu">
                  <Link href="/faq" onClick={() => setOpen(false)}>
                    FAQ
                  </Link>
                  <Link href="/#process" onClick={() => setOpen(false)}>
                    How It Works
                  </Link>
                  <Link href="/#reviews" onClick={() => setOpen(false)}>
                    Client Reviews
                  </Link>
                </div>
              </li>
              <li>
                <Link href="/#contact" aria-current={active === 'contact' ? 'page' : undefined}>
                  Contact
                </Link>
              </li>
            </ul>
            <div className="nav__cta">
              <a className="nav__login" href={login}>
                Login
              </a>
              <a
                className="btn btn--red"
                href={book}
                target={bookExternal ? '_blank' : undefined}
                rel={bookExternal ? 'noopener' : undefined}
              >
                <Icon name="calendar" />
                Schedule Appointment
              </a>
            </div>
          </nav>
        </div>
      </header>
    </>
  )
}
