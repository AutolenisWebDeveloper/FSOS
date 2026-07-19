import type { Config } from 'tailwindcss'

// FSOS Design System (docs/design-system.md). Dark navy shell + light content
// canvas, DM Sans / DM Mono, signature gold, visible securities firewall.
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
      fontFamily: {
        sans: ['var(--font-dm-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-dm-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        // Dark navy shell — sidebar / topbar / dense panels.
        shell: {
          DEFAULT: 'hsl(var(--shell))',
          raised: 'hsl(var(--shell-raised))',
          foreground: 'hsl(var(--shell-foreground))',
          muted: 'hsl(var(--shell-muted))',
          border: 'hsl(var(--shell-border))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        // Signature gold — GDC tier, assumptions, attention. Never for success.
        gold: {
          DEFAULT: 'hsl(var(--gold))',
          deep: 'hsl(var(--gold-deep))',
          foreground: 'hsl(var(--gold-foreground))',
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
        // FSOS status colors (design-system.md §3). Each maps to a token so a
        // stage/lifecycle value themes consistently across every archetype/badge.
        status: {
          draft: 'hsl(var(--status-draft))',
          active: 'hsl(var(--status-active))',
          pending: 'hsl(var(--status-pending))',
          won: 'hsl(var(--status-won))',
          lost: 'hsl(var(--status-lost))',
          blocked: 'hsl(var(--status-blocked))',
          escalated: 'hsl(var(--status-escalated))',
          // Guardrail 3: the "config default — verify" assumption badge (gold).
          assumption: 'hsl(var(--status-assumption))',
          // Guardrail 1: the is_security / FFS-managed marker (purple).
          security: 'hsl(var(--status-security))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 4px)',
      },
      // Brand-tuned elevation — remaps the default Tailwind shadow scale to the
      // layered navy tokens in globals.css so every `shadow-sm/md/lg/xl` reads
      // as intentional, financial-grade depth rather than generic gray drop.
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
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
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-in-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.24s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
