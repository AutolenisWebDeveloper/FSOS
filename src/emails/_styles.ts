// src/emails/_styles.ts — shared inline styles for the FSOS email templates (author-time).
// Farmers-blue headings, readable body. Inline so they survive cross-client rendering.
import type { CSSProperties } from 'react'

export const h1: CSSProperties = { color: '#1C428B', fontSize: '20px', fontWeight: 700, margin: '0 0 12px' }
export const p: CSSProperties = { color: '#1a1a1a', fontSize: '15px', lineHeight: '24px', margin: '0 0 16px' }
export const list: CSSProperties = { color: '#1a1a1a', fontSize: '15px', lineHeight: '24px', margin: '0 0 16px', paddingLeft: '20px' }
