// The command center JSX runs entirely client-side
// This page wraps it in a Next.js server component shell

import CommandCenter from '@/components/pages/CommandCenter'

export default function Home() {
  return <CommandCenter />
}
