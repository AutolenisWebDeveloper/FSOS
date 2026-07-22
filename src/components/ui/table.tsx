import * as React from 'react'
import { cn } from '@/lib/utils'

// Enterprise data table (Farmers-branded). The wrapper is an elevated white
// surface on the cooler canvas; a denser mono header, subtle zebra striping, and
// a soft brand-tinted hover give dense financial rows real scan structure.
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-x-auto rounded-xl border bg-card shadow-elev-xs">
      <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  ),
)
Table.displayName = 'Table'

// Sticky-capable header: pass `sticky` on a scroll container to pin it. The
// gradient + bottom hairline keep column labels legible over scrolling rows.
const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <thead
      ref={ref}
      className={cn('bg-muted/70 [&_tr]:border-b [&_tr]:border-border', className)}
      {...props}
    />
  ),
)
TableHeader.displayName = 'TableHeader'

// Zebra striping via nth-child keeps long financial tables readable without a
// per-row prop. Odd body rows take a faint recessed tint; hover still wins.
const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => (
    <tbody
      ref={ref}
      className={cn('[&_tr:last-child]:border-0 [&_tr:nth-child(even)]:bg-sunken/40', className)}
      {...props}
    />
  ),
)
TableBody.displayName = 'TableBody'

// Dense 40px rows (design-system.md §4/§6) — not shadcn's default spacing.
interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /**
   * Row acts as a link/button (row → detail). Adds cursor + a keyboard focus ring
   * so clickable rows are reachable and visible for keyboard users. Callers still
   * wire the navigation (onClick / a wrapping Link) and `tabIndex`/`role`.
   */
  interactive?: boolean
}

const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(
  ({ className, interactive, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'h-11 border-b transition-colors hover:bg-primary-soft/40 data-[state=selected]:bg-primary/[0.07]',
        interactive &&
          'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        className,
      )}
      {...props}
    />
  ),
)
TableRow.displayName = 'TableRow'

// 32px mono-label header cells. Numeric columns pass `text-right` + the `numeric`
// class on their cells for right-aligned tabular figures. Defaults `scope="col"`
// for screen-reader table semantics (override via the `scope` prop for row headers).
const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, scope = 'col', ...props }, ref) => (
    <th
      ref={ref}
      scope={scope}
      className={cn(
        'mono-label h-9 px-3 text-left align-middle font-semibold text-muted-foreground [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  ),
)
TableHead.displayName = 'TableHead'

const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => (
    <td ref={ref} className={cn('px-3 py-2 align-middle [&:has([role=checkbox])]:pr-0', className)} {...props} />
  ),
)
TableCell.displayName = 'TableCell'

// Programmatic table caption (DESIGN.md §7). The wrapper already sets
// `caption-bottom`; pass `srOnly` to name a table for screen readers without a
// visible caption. Every data table should name what it lists for a11y.
const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement> & { srOnly?: boolean }
>(({ className, srOnly, ...props }, ref) => (
  <caption
    ref={ref}
    className={cn(srOnly ? 'sr-only' : 'mt-3 px-3 text-sm text-muted-foreground', className)}
    {...props}
  />
))
TableCaption.displayName = 'TableCaption'

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell, TableCaption }
