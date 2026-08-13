'use client'

import * as React from 'react'
import { ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { cn } from '@/lib/utils'

/**
 * Shared list pagination footer. Presentational only — the list owns page /
 * page-size state and slices its rows with `paginate()` (lib/data/paginate); this
 * renders the entity-aware count, the rows-per-page selector, and First / Previous
 * / Next / Last controls consistently across every FSOS list.
 *
 * Terminology is entity-specific: pass the real singular/plural noun for the list
 * ("household" / "households", "opportunity" / "opportunities") so the count reads
 * "Showing 1–50 of 612 households", never "records".
 */

export const PAGE_SIZE_OPTIONS = [25, 50, 100, 250] as const

export interface ListPaginationProps {
  /** 0-based current page. Clamp with `paginate()` before passing. */
  page: number
  pageSize: number
  /** Total rows in the filtered set (not just the current page). */
  total: number
  /** Singular entity noun, lowercase, e.g. "contact". */
  noun: string
  /** Plural entity noun; defaults to `noun + "s"`. Supply for irregular plurals. */
  nounPlural?: string
  onPageChange: (page: number) => void
  /** Omit to hide the rows-per-page selector (fixed page size). */
  onPageSizeChange?: (size: number) => void
  pageSizeOptions?: readonly number[]
  className?: string
}

export function ListPagination({
  page,
  pageSize,
  total,
  noun,
  nounPlural,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: ListPaginationProps) {
  // Nothing to page over — the list renders its own empty/no-results state.
  if (total <= 0) return null

  const plural = nounPlural ?? `${noun}s`
  const size = Math.max(1, pageSize)
  const pageCount = Math.max(1, Math.ceil(total / size))
  const current = Math.min(Math.max(0, page), pageCount - 1)
  const from = current * size + 1
  const to = Math.min(total, (current + 1) * size)

  const smallestOption = pageSizeOptions.length ? Math.min(...pageSizeOptions) : size
  const showPageSize = !!onPageSizeChange && total > smallestOption
  const showNav = pageCount > 1

  const count =
    total === 1
      ? `Showing 1 of 1 ${noun}`
      : `Showing ${from.toLocaleString()}–${to.toLocaleString()} of ${total.toLocaleString()} ${plural}`

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 text-sm', className)}>
      <p className="text-muted-foreground" aria-live="polite">
        {count}
      </p>

      {showPageSize || showNav ? (
        <div className="flex flex-wrap items-center gap-3">
          {showPageSize ? (
            <label className="flex items-center gap-1.5 text-muted-foreground">
              <span className="whitespace-nowrap">Rows per page</span>
              <Select
                value={String(size)}
                onChange={(e) => onPageSizeChange!(Number(e.target.value))}
                className="h-8 w-[4.5rem]"
                aria-label="Rows per page"
              >
                {pageSizeOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}

          {showNav ? (
            <nav aria-label={`${plural} pagination`} className="flex items-center gap-2">
              <span className="whitespace-nowrap text-muted-foreground" aria-hidden>
                Page {current + 1} of {pageCount}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="First page"
                  disabled={current === 0}
                  onClick={() => onPageChange(0)}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous page"
                  disabled={current === 0}
                  onClick={() => onPageChange(current - 1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next page"
                  disabled={current >= pageCount - 1}
                  onClick={() => onPageChange(current + 1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Last page"
                  disabled={current >= pageCount - 1}
                  onClick={() => onPageChange(pageCount - 1)}
                >
                  <ChevronsRight className="h-4 w-4" />
                </Button>
              </div>
            </nav>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
