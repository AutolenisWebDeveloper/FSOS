'use client'

// Thin wrapper — dynamically imports fsos_command_center.jsx to avoid SSR issues.
// The command center runs entirely client-side (useState, useEffect, inline styles).

import dynamic from 'next/dynamic'

const CommandCenterApp = dynamic(
  () => import('./fsos_command_center'),
  {
    ssr: false,
    loading: () => (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#f4f6f9',
        fontFamily: "'DM Sans', 'Segoe UI', sans-serif",
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48,
            background: 'linear-gradient(135deg, #4299e1, #2b6cb0)',
            borderRadius: 12, display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 22, fontWeight: 700,
            color: '#fff', margin: '0 auto 16px',
          }}>M</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#1a2332', marginBottom: 6 }}>
            FSOS Command Center
          </div>
          <div style={{ fontSize: 13, color: '#6b7a8d' }}>Loading…</div>
        </div>
      </div>
    ),
  }
)

export default function CommandCenter() {
  return <CommandCenterApp />
}
