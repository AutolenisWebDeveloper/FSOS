import { Poppins, Inter } from 'next/font/google'

// Public marketing surface typography (Poppins display + Inter body). Exposed as
// CSS variables and applied only on the `.msite` wrapper, so the authenticated
// FSOS app keeps its DM Sans / DM Mono system untouched.
export const poppins = Poppins({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-poppins',
})

export const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-inter',
})

/** Class string to apply the marketing font variables on the `.msite` wrapper. */
export const marketingFontVars = `${poppins.variable} ${inter.variable}`
