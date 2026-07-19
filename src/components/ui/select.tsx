import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Lightweight native <select> styled to match the input system. A native control
 * keeps forms keyboard- and screen-reader-accessible with zero extra JS, which is
 * what the archetype a11y standard requires.
 */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Marks the field invalid (drives the destructive border/ring). Sets aria-invalid. */
  error?: boolean
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, error, 'aria-invalid': ariaInvalid, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={error || ariaInvalid || undefined}
        className={cn(
          'flex h-9 w-full appearance-none rounded-md border border-input bg-background px-3 py-1 pr-8 text-sm shadow-xs transition-[color,box-shadow,border-color] hover:border-ring/50 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-destructive/25',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  ),
)
Select.displayName = 'Select'

export { Select }
