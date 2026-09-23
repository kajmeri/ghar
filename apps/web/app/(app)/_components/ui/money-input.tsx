'use client'

import { ValidationError } from '@ghar/core/errors'
import { type Cents, currencySymbol, formatCents, parseMoneyInput } from '@ghar/core/money'
import { useEffect, useRef, useState } from 'react'
import { describedBy, Field } from '@/components/ui/field'
import { cn } from '@/lib/utils'

/**
 * An amount field. People type what they'd write ("1234.5", "1,234.56", "(40)"); the form
 * submits integer cents under `name`, and nothing else ever sees the text. The value tidies
 * itself on blur, and a problem shows once someone leaves the field, not while they type.
 *
 * parseMoneyInput reads two decimal places, so `currency` must be one with cents.
 */
export function MoneyInput({
  id,
  name,
  label,
  hint,
  error,
  defaultValue,
  currency = 'USD',
  locale = 'en-US',
  allowNegative = false,
  required = false,
  disabled = false,
  placeholder = '0.00',
  onValueChange,
  className,
}: {
  id: string
  name: string
  label: string
  hint?: string
  /** A server-side error for this field. It wins over the field's own check. */
  error?: string
  defaultValue?: Cents
  currency?: string
  locale?: string
  allowNegative?: boolean
  required?: boolean
  disabled?: boolean
  placeholder?: string
  /** Called with cents as the text changes, or null while it isn't a valid amount. */
  onValueChange?: (cents: Cents | null) => void
  className?: string
}) {
  const format = (cents: Cents) => formatCents(cents, { currency, locale, symbol: false })
  const [text, setText] = useState(() => (defaultValue === undefined ? '' : format(defaultValue)))
  const [left, setLeft] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const result = read(text, { allowNegative, required })
  const shownError = error ?? (left ? result.error : undefined)

  // Lets a form without noValidate stop on a bad amount, like any other invalid field.
  useEffect(() => {
    inputRef.current?.setCustomValidity(result.error ?? '')
  }, [result.error])

  return (
    <Field id={id} label={label} hint={hint} error={shownError} className={className}>
      <div
        className={cn(
          'flex h-tap w-full min-w-0 items-center rounded-control border border-input bg-surface has-[input:disabled]:opacity-40 has-[input:focus-visible]:ring-2 has-[input:focus-visible]:ring-ring',
          shownError && 'border-negative'
        )}
      >
        <span aria-hidden className='pl-3 text-base text-ink-muted'>
          {currencySymbol(currency, locale)}
        </span>
        <input
          ref={inputRef}
          id={id}
          type='text'
          inputMode='decimal'
          autoComplete='off'
          value={text}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          aria-invalid={Boolean(shownError)}
          aria-describedby={describedBy(id, shownError, hint)}
          onChange={event => {
            setText(event.target.value)
            const next = read(event.target.value, { allowNegative, required })
            onValueChange?.(next.error ? null : next.cents)
          }}
          onBlur={() => {
            setLeft(true)
            if (result.cents !== null && !result.error) setText(format(result.cents))
          }}
          className='h-full min-w-0 flex-1 bg-transparent pr-3 pl-1 text-base text-ink placeholder:text-ink-muted focus-visible:outline-hidden'
        />
      </div>
      <input type='hidden' name={name} value={result.cents ?? ''} disabled={disabled} />
    </Field>
  )
}

function read(
  text: string,
  { allowNegative, required }: { allowNegative: boolean; required: boolean }
): { cents: Cents | null; error?: string } {
  if (text.trim() === '') return { cents: null, error: required ? 'Enter an amount' : undefined }

  let cents: Cents
  try {
    cents = parseMoneyInput(text)
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    return {
      cents: null,
      error: /\.\d{3,}/.test(text) ? 'Use no more than two decimal places' : 'Enter an amount like 1,234.56',
    }
  }

  if (cents < 0 && !allowNegative) return { cents: null, error: 'Enter an amount of zero or more' }
  return { cents }
}
