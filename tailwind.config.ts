import type { Config } from 'tailwindcss'

// FSOS design system (CLAUDE.md §1.6, archetypes.md "Design system").
// Professional financial-services aesthetic, light-first with dark tokens ready.
// Tailwind scans ONLY the new App-Router UI (src/app, src/components). Legacy
// command-center screens keep their inline styles and are intentionally not
// re-themed here (CLAUDE.md §1.6 — do not convert legacy inline UI).
const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // FSOS status colors (archetypes.md design system). Each maps to a
        // token so it themes consistently across every archetype/badge.
        status: {
          draft: 'hsl(var(--status-draft))',
          active: 'hsl(var(--status-active))',
          pending: 'hsl(var(--status-pending))',
          won: 'hsl(var(--status-won))',
          lost: 'hsl(var(--status-lost))',
          blocked: 'hsl(var(--status-blocked))',
          escalated: 'hsl(var(--status-escalated))',
          // Guardrail-specific: the "config default — verify" assumption badge.
          assumption: 'hsl(var(--status-assumption))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
