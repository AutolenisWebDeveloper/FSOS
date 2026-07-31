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
          highlight: 'hsl(var(--shell-highlight))',
          foreground: 'hsl(var(--shell-foreground))',
          muted: 'hsl(var(--shell-muted))',
          border: 'hsl(var(--shell-border))',
        },
        // Recessed canvas surface for section wells / zebra rows.
        sunken: 'hsl(var(--surface-sunken))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          soft: 'hsl(var(--primary-soft))',
          deep: 'hsl(var(--primary-deep))',
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
        // AI-first surfaces (design-system.md §25). Indigo-shifted, adjacent to
        // Farmers blue — a distinct-but-native AI voice. NOT the guardrail purple.
        ai: {
          DEFAULT: 'hsl(var(--ai))',
          foreground: 'hsl(var(--ai-foreground))',
          surface: 'hsl(var(--ai-surface))',
          'surface-foreground': 'hsl(var(--ai-surface-foreground))',
          border: 'hsl(var(--ai-border))',
          shell: 'hsl(var(--ai-shell))',
        },
        // Categorical chart ramp (design-system.md §15). Data-series identity
        // ONLY — a chart hue never denotes compliance status.
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
          6: 'hsl(var(--chart-6))',
          7: 'hsl(var(--chart-7))',
          8: 'hsl(var(--chart-8))',
          positive: 'hsl(var(--chart-positive))',
          negative: 'hsl(var(--chart-negative))',
          neutral: 'hsl(var(--chart-neutral))',
          grid: 'hsl(var(--chart-grid))',
          axis: 'hsl(var(--chart-axis))',
          track: 'hsl(var(--chart-track))',
        },
        // Workspace navigation surfaces on the navy shell (design-system.md §12).
        nav: {
          active: 'hsl(var(--nav-active))',
          'active-bar': 'hsl(var(--nav-active-bar))',
          hover: 'hsl(var(--nav-hover))',
          foreground: 'hsl(var(--nav-foreground))',
          muted: 'hsl(var(--nav-muted))',
          section: 'hsl(var(--nav-section))',
        },
        // Command palette (⌘K) overlay surfaces.
        palette: {
          DEFAULT: 'hsl(var(--palette-bg))',
          raised: 'hsl(var(--palette-raised))',
          border: 'hsl(var(--palette-border))',
          selected: 'hsl(var(--palette-selected))',
          foreground: 'hsl(var(--palette-foreground))',
          muted: 'hsl(var(--palette-muted))',
          kbd: 'hsl(var(--palette-kbd))',
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
        // Overlay tier — command palette / floating drawers (design-system.md §6.7).
        '2xl': 'var(--shadow-2xl)',
      },
      // Workspace-shell geometry + dashboard density (design-system.md §6.7).
      spacing: {
        rail: 'var(--rail-width)',
        sidebar: 'var(--sidebar-width)',
        'sidebar-wide': 'var(--sidebar-width-wide)',
        topbar: 'var(--topbar-height)',
        gutter: 'var(--gutter)',
        section: 'var(--section-gap)',
        'row-compact': 'var(--density-row-compact)',
        row: 'var(--density-row)',
        'row-cozy': 'var(--density-row-cozy)',
      },
      // Motion tokens (design-system.md §23) — durations + easing curves so every
      // transition reads from one system instead of ad-hoc ms/cubic-beziers.
      transitionDuration: {
        instant: 'var(--motion-instant)',
        fast: 'var(--motion-fast)',
        base: 'var(--motion-base)',
        slow: 'var(--motion-slow)',
      },
      transitionTimingFunction: {
        standard: 'var(--ease-standard)',
        emphasized: 'var(--ease-emphasized)',
        exit: 'var(--ease-exit)',
        spring: 'var(--ease-spring)',
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
        // Command palette / menu entrance (design-system.md §23).
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.98) translateY(-4px)' },
          to: { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
        'fade-in-up': 'fade-in-up 0.24s ease-out',
        'scale-in': 'scale-in var(--motion-fast) var(--ease-emphasized)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}

export default config
