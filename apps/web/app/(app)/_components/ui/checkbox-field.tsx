import type * as React from 'react'

/** A checkbox with its label and an optional hint. The whole row is the tap target. */
export function CheckboxField({
  label,
  hint,
  ...props
}: Omit<React.ComponentProps<'input'>, 'type'> & { label: string; hint?: string }) {
  return (
    <label className='flex min-h-tap cursor-pointer items-start gap-3 py-2.5'>
      <input type='checkbox' className='mt-0.5 size-5 shrink-0 accent-ink' {...props} />
      <span className='flex min-w-0 flex-col'>
        <span className='text-base'>{label}</span>
        {hint ? <span className='text-sm text-ink-muted'>{hint}</span> : null}
      </span>
    </label>
  )
}
