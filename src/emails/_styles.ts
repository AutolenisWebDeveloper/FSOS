// src/emails/_styles.ts — shared inline styles for the FSOS email templates (author-time).
// Kept as thin, token-resolved primitives; new templates compose src/emails/_components.tsx.
// Every value resolves through the shared brand tokens (src/lib/email/brand.ts) so headings
// and body copy match the redesigned layout and the runtime transactional emails.
import type { CSSProperties } from 'react'
import { EMAIL_COLORS as C, EMAIL_TYPE as T, EMAIL_SPACE as S } from '@/lib/email/brand'

export const h1: CSSProperties = { color: C.ink, fontSize: T.h1, lineHeight: '30px', fontWeight: 700, margin: `0 0 ${S.md}px` }
export const p: CSSProperties = { color: C.body, fontSize: T.body, lineHeight: '25px', margin: `0 0 ${S.md}px` }
export const list: CSSProperties = { color: C.body, fontSize: T.body, lineHeight: '25px', margin: `0 0 ${S.md}px`, paddingLeft: '20px' }
