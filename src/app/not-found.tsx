import Link from 'next/link'
import { Home } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <main className="shell-gradient flex min-h-screen flex-col items-center justify-center gap-3 px-6 py-16 text-center text-shell-foreground">
      <p className="font-mono text-5xl font-bold tracking-tight tabular-nums">404</p>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="max-w-sm text-sm leading-relaxed text-shell-muted">
        The page you&apos;re looking for doesn&apos;t exist or has moved.
      </p>
      <Button
        asChild
        variant="outline"
        className="mt-3 border-shell-border/70 bg-white/10 text-shell-foreground hover:bg-white/20 hover:text-shell-foreground"
      >
        <Link href="/">
          <Home className="h-4 w-4" aria-hidden />
          Return home
        </Link>
      </Button>
    </main>
  )
}
