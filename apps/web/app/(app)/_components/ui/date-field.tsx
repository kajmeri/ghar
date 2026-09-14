import type { CalendarDate } from '@ghar/core/dates';
import { describedBy, Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/**
 * A calendar date with no time: a due date, a trip start. The platform's own picker, so phones
 * get their native wheel. Submits yyyy-MM-dd, which is already a CalendarDate.
 */
export function DateField({
  id,
  name,
  label,
  hint,
  error,
  defaultValue,
  min,
  max,
  required,
  disabled,
  className,
}: {
  id: string;
  name: string;
  label: string;
  hint?: string;
  error?: string;
  defaultValue?: CalendarDate;
  min?: CalendarDate;
  max?: CalendarDate;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <Input
        id={id}
        name={name}
        type="date"
        defaultValue={defaultValue}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, error, hint)}
        // iOS centers the value and shrinks an empty field; WebKit's picker icon is heavy.
        className="block appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left"
      />
    </Field>
  );
}
