import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

// Includes FSOS status variants (archetypes.md) so a stage/lifecycle value renders
// consistently everywhere, plus `assumption` for the "config default — verify"
// badge required by guardrail 3 (no-invented-Farmers-data, archetype A10).
const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'text-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        draft: 'border-transparent bg-status-draft/15 text-status-draft',
        active: 'border-transparent bg-status-active/15 text-status-active',
        pending: 'border-transparent bg-status-pending/15 text-status-pending',
        won: 'border-transparent bg-status-won/15 text-status-won',
        lost: 'border-transparent bg-status-lost/15 text-status-lost',
        blocked: 'border-transparent bg-status-blocked/15 text-status-blocked',
        escalated: 'border-transparent bg-status-escalated/15 text-status-escalated',
        assumption: 'border-status-assumption/40 bg-status-assumption/10 text-status-assumption',
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
