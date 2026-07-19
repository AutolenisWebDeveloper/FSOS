import { redirect } from 'next/navigation'

// The legacy command center is retired. The official dashboard is /app.
// Middleware already redirects "/" → /app; this is a defense-in-depth fallback
// (and severs the last import of the legacy CommandCenter component).
export default function Home() {
  redirect('/app')
}
