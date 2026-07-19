import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// FSOS status chips (docs/design-system.md §6): 22px, radius 4, DM Mono 10px
// uppercase tracked, status color at ~12% bg + full-strength text. Includes the
// guardrail markers: `assumption` (gold "config default — verify") and `security`
// (purple "FFS-managed") — the two badges that make the firewall + no-invented-data
// rules visible in the UI.
const badgeVariants = cva(
  'inline-flex h-[22px] items-center rounded-[4px] border px-2 font-mono text-[10px] font-medium uppercase leading-none tracking-wider transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        draft: 'border-transparent bg-status-draft/15 text-status-draft',
        active: 'border-transparent bg-status-active/15 text-status-active',
        pending: 'border-transparent bg-status-pending/15 text-status-pending',
        won: 'border-transparent bg-status-won/15 text-status-won',
        lost: 'border-transparent bg-status-lost/15 text-status-lost',
        blocked: 'border-transparent bg-status-blocked/15 text-status-blocked',
        escalated: 'border-transparent bg-status-escalated/15 text-status-escalated',
        // Guardrail 3 — no invented Farmers data.
        assumption: 'border-status-assumption/40 bg-status-assumption/12 text-status-assumption',
        // Guardrail 1 — securities firewall made visible.
        security: 'border-status-security/40 bg-status-security/12 text-status-security',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
