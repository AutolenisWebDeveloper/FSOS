import { redirect } from 'next/navigation'

// About is now a section of the homepage (see the FSA content build). Preserve the
// old /about URL by redirecting to the homepage About section.
export default function AboutPage() {
  redirect('/#about')
}
