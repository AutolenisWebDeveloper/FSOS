import { SiteShell } from '@/components/public/site/SiteShell'

// WS-056: the public workshop funnel runs several sequential server queries (workshop +
// session + presenters + signed asset URLs + seat count). Without a boundary the browser
// sits on the previous page with no feedback. This skeleton mirrors the hero + card grid
// so the layout does not jump when the real content streams in (DESIGN loading ladder:
// a skeleton, never a bare spinner). Covers /workshops and every nested route.
export default function Loading() {
  return (
    <SiteShell active="workshops">
      <main id="main" aria-busy="true">
        <div className="shell" style={{ padding: 'clamp(32px,5vw,64px) 0' }}>
          <span className="vh">Loading workshops…</span>
          <div className="wskel wskel--title" />
          <div className="wskel wskel--sub" />
          <div className="wgrid" style={{ marginTop: 28 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="wskel wskel--card" />
            ))}
          </div>
        </div>
      </main>
    </SiteShell>
  )
}
