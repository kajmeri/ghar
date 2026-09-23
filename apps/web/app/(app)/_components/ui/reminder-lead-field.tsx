import { leadTimePhrase, REMINDER_LEAD_DAYS_OPTIONS } from '@ghar/core/expiries'
import { Field } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'

/**
 * How far ahead reminders start for one thing, for a form. Empty means the default for its kind,
 * which is named in the first option. Read it back with `remindFromDaysOf`.
 */
export function ReminderLeadField({
  name = 'remindFromDays',
  value,
  defaultLeadDays,
  hint = 'The first email goes then, and more follow as the date gets closer.',
}: {
  name?: string
  /** The lead time picked for it now. Null for the default. */
  value: number | null | undefined
  /** What the default comes to for this thing. */
  defaultLeadDays: number
  hint?: string
}) {
  const options: readonly number[] =
    value && !(REMINDER_LEAD_DAYS_OPTIONS as readonly number[]).includes(value)
      ? [...REMINDER_LEAD_DAYS_OPTIONS, value].sort((a, b) => a - b)
      : REMINDER_LEAD_DAYS_OPTIONS
  return (
    <Field label='Start reminding' hint={hint}>
      <NativeSelect name={name} defaultValue={value ?? ''}>
        <option value=''>{leadTimePhrase(defaultLeadDays)} before (the usual)</option>
        {options.map(days => (
          <option key={days} value={days}>
            {leadTimePhrase(days)} before
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}

/** The field's value: a number of days, or null for the default. */
export function remindFromDaysOf(data: FormData, name = 'remindFromDays'): number | null {
  const value = data.get(name)
  return typeof value === 'string' && value !== '' ? Number(value) : null
}
