import * as React from 'react'
import '@/app/marketing.css'
import { marketingFontVars } from '@/lib/fonts'
import { SiteHeader } from './SiteHeader'
import { SiteFooter } from './SiteFooter'
import { SiteReveal } from './SiteReveal'

/**
 * Wrapper for every public marketing page. Applies the `.msite` theme scope +
 * Poppins/Inter font variables, the shared header/footer, a skip link, and the
 * reveal enhancer. Children are the page's own <main>.
 */
export function SiteShell({
  children,
  active = 'none',
}: {
  children: React.ReactNode
  active?: 'home' | 'contact' | 'none'
}) {
  return (
    <div className={`msite ${marketingFontVars}`}>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <SiteHeader active={active} />
      {children}
      <SiteFooter />
      <SiteReveal />
    </div>
  )
}
