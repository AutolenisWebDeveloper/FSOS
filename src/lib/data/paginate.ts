/**
 * Pure, framework-free pagination math shared by every FSOS list.
 *
 * FSOS list pages load their (already filtered + sorted) row set and slice it for
 * display client-side — the established idiom (AgencyList, fna/plans). This helper
 * centralises the arithmetic so every list paginates identically and correctly,
 * including the edge cases the spec calls out: an out-of-range page after a filter
 * shrinks the set, a page size change, and an empty result. It is deliberately
 * DB-free so it can be unit-tested in isolation (tests/pagination.test.mjs).
 */

export interface Paged<T> {
  /** Rows for the current page (a slice of the input, order preserved). */
  items: T[]
  /** The requested page clamped into [0, pageCount - 1]; always 0-based. */
  page: number
  /** Total number of pages (at least 1, even when there are no rows). */
  pageCount: number
  /** Total rows in the (already filtered) input set. */
  total: number
  /** Effective page size (at least 1). */
  pageSize: number
  /** 1-based index of the first row shown on this page; 0 when empty. */
  from: number
  /** 1-based index of the last row shown on this page; 0 when empty. */
  to: number
}

/**
 * Slice `items` for a 0-based `page`. The requested page is clamped, so a page
 * that has become empty (filters narrowed the set, rows were deleted) resolves to
 * the last valid page instead of showing a blank table — deterministic because the
 * caller supplies an already-ordered array.
 */
export function paginate<T>(items: readonly T[], page: number, pageSize: number): Paged<T> {
  const total = items.length
  const size = Math.max(1, Math.floor(pageSize) || 1)
  const pageCount = Math.max(1, Math.ceil(total / size))
  const clamped = Math.min(Math.max(0, Math.floor(page) || 0), pageCount - 1)
  const start = clamped * size
  const pageItems = items.slice(start, start + size)
  return {
    items: pageItems,
    page: clamped,
    pageCount,
    total,
    pageSize: size,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + pageItems.length,
  }
}
