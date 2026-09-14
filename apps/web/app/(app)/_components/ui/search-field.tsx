'use client'

import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

/** Filters a list as someone types. The label is for screen readers; the placeholder says what it finds. */
export function SearchField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className='relative'>
      <Search aria-hidden className='pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-muted' />
      <Input
        type='search'
        aria-label={label}
        value={value}
        onChange={event => {
          onChange(event.target.value)
        }}
        placeholder={placeholder}
        autoComplete='off'
        enterKeyHint='search'
        className='pl-10'
      />
    </div>
  )
}
