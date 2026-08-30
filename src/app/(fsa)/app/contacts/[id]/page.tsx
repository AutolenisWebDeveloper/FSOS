import { ContactRecord } from '@/components/app/contact/ContactRecord'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/*
 * Contact Detail — the single-client workspace reached from the Contacts book,
 * contact creation, the Win-Back queue, an appointment, and social attribution.
 *
 * The whole record is composed by <ContactRecord/> (components/app/contact/*),
 * which owns the identity band, the attention strip, the section shell, and the
 * reference rail. Sections are addressed by `?s=` so every one of them is a
 * server-rendered, deep-linkable URL rather than client tab state.
 */
export default async function ContactDetailPage(props: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ s?: string }>
}) {
  const [{ id }, sp] = await Promise.all([props.params, props.searchParams])
  return <ContactRecord id={id} section={sp?.s} />
}
