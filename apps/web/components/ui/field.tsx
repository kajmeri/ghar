import { cloneElement, isValidElement, useId } from 'react'
import type * as React from 'react'

import { cn } from '@/lib/utils'

export { Input } from './input'

const control =
  'w-full rounded-control border border-input bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden disabled:opacity-40 aria-invalid:border-negative'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-tap py-3', className)} {...props} />
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(control, 'h-tap pr-8', className)} {...props} />
}

function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('text-sm font-medium text-ink', className)} {...props} />
}

/** What Field hands its control when it wires the control up itself. */
type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: React.AriaAttributes['aria-invalid']
}

/**
 * A label, its control, and an optional hint or error. Sentence case, no all-caps eyebrow.
 *
 * With an `id`, pass the same one to the control, with
 * `aria-describedby={describedBy(id, error, hint)}` and `aria-invalid={Boolean(error)}`.
 * Without one, Field makes an id and puts it, the description and the invalid state on its one
 * child control, so the hint or error is read with the control and not folded into its name.
 * Props the control already has win.
 */
function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id?: string
  label: string
  hint?: string
  error?: string
  className?: string
  children: React.ReactNode
}) {
  const autoId = useId()
  const child = id === undefined && isValidElement<ControlProps>(children) ? children : null

  if (id === undefined && child === null) {
    // Not a single control to wire up, so the label wraps whatever is there.
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <label className='flex flex-col gap-1.5'>
          <span className='text-sm font-medium text-ink'>{label}</span>
          {children}
        </label>
        <FieldMessage id={autoId} error={error} hint={hint} />
      </div>
    )
  }

  const controlId = id ?? child?.props.id ?? autoId

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={controlId} className='text-sm font-medium text-ink'>
        {label}
      </label>
      {child
        ? cloneElement(child, {
            id: controlId,
            'aria-describedby': child.props['aria-describedby'] ?? describedBy(controlId, error, hint),
            'aria-invalid': child.props['aria-invalid'] ?? (error ? true : undefined),
          })
        : children}
      <FieldMessage id={controlId} error={error} hint={hint} />
    </div>
  )
}

/** The error, announced as it appears, or else the hint. Ids match describedBy. */
function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-error`} role='alert' className='text-sm text-negative'>
        {error}
      </p>
    )
  }
  return hint ? (
    <p id={`${id}-hint`} className='text-sm text-ink-muted'>
      {hint}
    </p>
  ) : null
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  if (error) return `${id}-error`
  return hint ? `${id}-hint` : undefined
}

/**
 * The message a form shows under its button after the action runs. An error interrupts, as an
 * alert; success waits its turn, as a status. The empty status stays mounted so the first
 * message into it is announced.
 */
function FormMessage({ state }: { state: { status: string; message?: string } }) {
  const message = state.status === 'idle' ? undefined : state.message
  if (state.status === 'error' && message) {
    return (
      <p role='alert' className='text-sm text-negative'>
        {message}
      </p>
    )
  }
  return (
    <p role='status' className={message ? 'text-sm text-ink-muted' : 'sr-only'}>
      {message}
    </p>
  )
}

export { describedBy, Field, FormMessage, Label, Select, Textarea }
