import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// FSOS button system (Farmers-branded). One shared base tunes focus, disabled,
// and press feedback; variants give a complete primary / secondary / tertiary
// (outline) / ghost / destructive / link / icon vocabulary. The primary and
// destructive fills carry a restrained two-stop gradient + inset top highlight
// so key actions read with institutional depth rather than a flat block.
const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[background,box-shadow,transform,border-color,color] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none active:translate-y-px [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'brand-fill text-primary-foreground shadow-sm hover:shadow-md hover:brightness-[1.07] active:brightness-95',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:shadow-md hover:brightness-[1.07] active:brightness-95',
        outline:
          'border border-input bg-card text-foreground shadow-xs hover:border-primary/50 hover:bg-primary-soft/50 hover:text-primary active:bg-primary-soft/70',
        secondary:
          'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/70 active:bg-secondary/90',
        ghost: 'text-foreground hover:bg-muted hover:text-foreground active:translate-y-0 active:bg-muted/80',
        link: 'text-primary underline-offset-4 hover:underline active:translate-y-0',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-8 rounded-md px-3 text-xs',
        lg: 'h-10 rounded-md px-6 text-[15px]',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  /**
   * Async pending state: shows a leading spinner, disables the button, and marks
   * it `aria-busy`. Standardizes the pattern so async actions across every page
   * stop hand-rolling their own spinners. Ignored when `asChild` is set (the
   * child owns its content).
   */
  loading?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    // asChild forwards to a single child element (Slot); a spinner would inject a
    // second child and throw — so only decorate the plain-button path.
    if (asChild) {
      return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>{children}</Comp>
    }
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {children}
      </Comp>
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
