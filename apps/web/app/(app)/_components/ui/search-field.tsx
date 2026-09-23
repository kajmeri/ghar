'use client'

import { Search } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'

const SEARCH_DELAY_MS = 250

/**
 * Searches the list on this page as someone types, through `?q=` so the server does the matching
 * and the list itself stays a Server Component. Without JavaScript it's a plain GET form, which is
 * why the page's other filters ride along as hidden fields. The label is for screen readers; the
 * placeholder says what it finds.
 */
export function SearchField({ label, defaultValue, placeholder }: { label: string; defaultValue: string; placeholder: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(defaultValue)
  const [, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  // Back and forward change the query from outside; follow it unless someone is typing here.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setValue(defaultValue)
  }, [defaultValue])

  useEffect(() => () => clearTimeout(timer.current), [])

  function search(next: string) {
    clearTimeout(timer.current)
    const q = next.trim()
    const url = new URLSearchParams(params)
    if (q === '') url.delete('q')
    else url.set('q', q)
    const query = url.toString()
    startTransition(() => {
      router.replace(query === '' ? pathname : `${pathname}?${query}`, { scroll: false })
    })
  }

  // The filters this page already has, so submitting without JavaScript keeps them.
  const kept = [...params.entries()].filter(([name]) => name !== 'q')

  return (
    <form
      role='search'
      aria-label={label}
      action={pathname}
      onSubmit={event => {
        event.preventDefault()
        search(value)
      }}
      className='relative'
    >
      {kept.map(([name, filter]) => (
        <input key={`${name}=${filter}`} type='hidden' name={name} value={filter} />
      ))}
      <Search aria-hidden className='pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted' />
      <Input
        ref={inputRef}
        type='search'
        name='q'
        aria-label={label}
        value={value}
        onChange={event => {
          const next = event.target.value
          setValue(next)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            search(next)
          }, SEARCH_DELAY_MS)
        }}
        placeholder={placeholder}
        autoComplete='off'
        enterKeyHint='search'
        className='pl-10'
      />
    </form>
  )
}
