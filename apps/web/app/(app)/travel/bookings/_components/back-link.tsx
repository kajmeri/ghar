import { ChevronLeft } from 'lucide-react'
import Link from 'next/link'

export function BackLink({ href, children }: { href: string; children: string }) {
  return (
    <Link
      href={href}
      className='-ml-1 mb-2 inline-flex min-h-tap items-center gap-1 rounded-control pr-2 text-sm text-ink-muted outline-none hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50'
    >
      <ChevronLeft aria-hidden className='size-4' />
      {children}
    </Link>
  )
}
