'use client'

// Client-side JSON fetch helper for P0 forms. Surfaces field-level Zod errors
// (details.fieldErrors) so forms can focus + describe the first failing input.

export interface ApiError {
  error: string
  reason?: string
  details?: { fieldErrors?: Record<string, string[]>; formErrors?: string[] }
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: ApiError }

async function request<T>(method: string, url: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, status: res.status, error: json as ApiError }
    return { ok: true, data: json as T }
  } catch (e) {
    return { ok: false, status: 0, error: { error: e instanceof Error ? e.message : 'Network error' } }
  }
}

export const postJson = <T = unknown>(url: string, body?: unknown) => request<T>('POST', url, body)
export const patchJson = <T = unknown>(url: string, body?: unknown) => request<T>('PATCH', url, body)
export const deleteJson = <T = unknown>(url: string, body?: unknown) => request<T>('DELETE', url, body)

/** Pull the first field error out of a Zod flatten() payload. */
export function firstFieldError(err: ApiError): { field?: string; message: string } {
  const fe = err.details?.fieldErrors
  if (fe) {
    const key = Object.keys(fe)[0]
    if (key && fe[key]?.[0]) return { field: key, message: fe[key][0] }
  }
  if (err.details?.formErrors?.[0]) return { message: err.details.formErrors[0] }
  return { message: err.error || 'Something went wrong' }
}
