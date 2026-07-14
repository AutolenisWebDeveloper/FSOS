import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * `cn` — the shadcn/ui class-name combiner. Merges conditional clsx input and
 * de-dupes conflicting Tailwind utilities (twMerge). Used by every UI primitive
 * and archetype shell.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
