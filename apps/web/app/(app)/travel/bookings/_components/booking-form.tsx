'use client'

import type { Booking, DraftBooking } from '@ghar/contracts'
import type { WallClock } from '@ghar/core/dates'
import {
  BOOKING_KINDS,
  BOOKING_STATUSES,
  CABINS,
  CARRIERS,
  CONFIRMATION_CODE_MAX_LENGTH,
  MAX_TRAVELERS,
  PLACE_MAX_LENGTH,
  PROPERTY_NAME_MAX_LENGTH,
  PROVIDER_NAME_MAX_LENGTH,
  RATE_PLANS,
} from '@ghar/core/travel'
import Link from 'next/link'
import { useActionState, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { MoneyInput } from '@/app/(app)/_components/ui/money-input'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import { REVIEW_PATH } from '@/lib/mail/display'
import { CABIN_LABELS, KIND_LABELS, ratePlanLabel, STATUS_LABELS } from '@/lib/travel/display'
import { createBookingAction, updateBookingAction } from '../actions'
import { confirmDraftAction } from '../review/actions'

/** A booking as the form edits it: departure times as wall-clock values in the household's zone. */
export type BookingFormDefaults = Omit<Booking, 'departAt' | 'returnAt'> & {
  departAt: WallClock | null
  returnAt: WallClock | null
}

/** A booking read from an email, the same way. What was paid may be missing. */
export type DraftFormDefaults = Omit<DraftBooking, 'departAt' | 'returnAt'> & {
  departAt: WallClock | null
  returnAt: WallClock | null
}

type Kind = Booking['kind']

const DATETIME_CLASS =
  'block appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left'

/**
 * Adds a booking, edits one when `booking` is given, or saves one read from an email when `draft`
 * is given, with what couldn't be read marked before anything is submitted. Only the fields for
 * its kind show.
 */
export function BookingForm({
  booking,
  draft,
  currency,
  timeZone,
}: {
  booking?: BookingFormDefaults
  draft?: { id: string; booking: DraftFormDefaults; problems: Partial<Record<string, string[]>> }
  currency: string
  timeZone: string
}) {
  const [state, formAction, pending] = useActionState(
    draft ? confirmDraftAction : booking ? updateBookingAction : createBookingAction,
    IDLE
  )
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, state)
  const initial = draft?.booking ?? booking
  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'flight')
  const error = (field: string) => (state.status === 'idle' && draft ? draftProblem(draft, field) : fieldError(state, field))

  /** What a field starts with: what was just submitted if it needs fixing, else the booking's. */
  function value(field: keyof DraftFormDefaults): string | undefined {
    if (state.status === 'error') return submittedValue(state, field) ?? ''
    const start = initial?.[field]
    return start === null || start === undefined ? undefined : String(start)
  }
  function checked(field: 'refundable' | 'watchEnabled', fallback: boolean): boolean {
    if (state.status === 'error') return submittedValue(state, field) === 'on'
    return initial?.[field] ?? fallback
  }

  const paid = value('paidCents')
  const bookingCurrency = initial?.currency ?? currency

  return (
    <form ref={formRef} action={formAction} noValidate className='flex flex-col gap-6 rounded-card border border-line bg-surface p-4 md:p-6'>
      {draft ? <input type='hidden' name='draftId' value={draft.id} /> : null}
      {booking && !draft ? <input type='hidden' name='bookingId' value={booking.id} /> : null}
      <input type='hidden' name='currency' value={bookingCurrency} />

      <fieldset className='flex flex-col gap-1.5'>
        <legend className='mb-1.5 text-sm font-medium text-ink'>What did you book?</legend>
        <div className='grid grid-cols-3 gap-2'>
          {BOOKING_KINDS.map(option => (
            <label
              key={option}
              className='flex min-h-tap items-center justify-center rounded-control border border-line bg-surface px-2 text-center text-base hover:border-ink/40 has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-surface'
            >
              <input
                type='radio'
                name='kind'
                value={option}
                checked={kind === option}
                onChange={() => {
                  setKind(option)
                }}
                className='sr-only'
              />
              {KIND_LABELS[option]}
            </label>
          ))}
        </div>
      </fieldset>

      {kind === 'flight' ? (
        <div className='grid gap-4 md:grid-cols-2'>
          <SelectField id='booking-carrier' name='carrier' label='Airline' error={error('carrier')} defaultValue={value('carrier') ?? ''}>
            <option value='' disabled>
              Choose an airline
            </option>
            {CARRIERS.map(carrier => (
              <option key={carrier.code} value={carrier.code}>
                {carrier.name}
              </option>
            ))}
          </SelectField>
          <SelectField
            id='booking-cabin'
            name='cabin'
            label='Fare'
            hint='Basic economy is the fare with no changes or seat choice'
            error={error('cabin')}
            defaultValue={value('cabin') ?? 'economy'}
          >
            {CABINS.map(cabin => (
              <option key={cabin} value={cabin}>
                {CABIN_LABELS[cabin]}
              </option>
            ))}
          </SelectField>
          <TextField
            id='booking-origin'
            name='origin'
            label='From'
            hint='Airport code, like BWI'
            autoCapitalize='characters'
            autoComplete='off'
            maxLength={PLACE_MAX_LENGTH}
            error={error('origin')}
            defaultValue={value('origin')}
          />
          <TextField
            id='booking-destination'
            name='destination'
            label='To'
            hint='Airport code, like MCO'
            autoCapitalize='characters'
            autoComplete='off'
            maxLength={PLACE_MAX_LENGTH}
            error={error('destination')}
            defaultValue={value('destination')}
          />
          <TextField
            id='booking-depart'
            name='departAt'
            type='datetime-local'
            label='Departs'
            hint={`In ${timeZone}`}
            className={DATETIME_CLASS}
            error={error('departAt')}
            defaultValue={value('departAt')}
          />
          <TextField
            id='booking-return'
            name='returnAt'
            type='datetime-local'
            label='Returns'
            hint='Leave blank for a one-way trip'
            className={DATETIME_CLASS}
            error={error('returnAt')}
            defaultValue={value('returnAt')}
          />
          <CheckboxField
            id='booking-refundable'
            name='refundable'
            label='Refundable ticket'
            hint='Cancelling gets your money back, not just credit'
            defaultChecked={checked('refundable', false)}
            className='md:col-span-2'
          />
        </div>
      ) : kind === 'hotel' ? (
        <div className='grid gap-4 md:grid-cols-2'>
          <TextField
            id='booking-property'
            name='propertyName'
            label='Hotel'
            maxLength={PROPERTY_NAME_MAX_LENGTH}
            error={error('propertyName')}
            defaultValue={value('propertyName')}
          />
          <TextField
            id='booking-city'
            name='destination'
            label='City'
            maxLength={PLACE_MAX_LENGTH}
            error={error('destination')}
            defaultValue={value('destination')}
          />
          <DateField id='booking-check-in' name='checkIn' label='Check-in' error={error('checkIn')} defaultValue={value('checkIn')} />
          <DateField id='booking-check-out' name='checkOut' label='Check-out' error={error('checkOut')} defaultValue={value('checkOut')} />
          <RatePlanField kind={kind} error={error('ratePlan')} defaultValue={value('ratePlan')} />
        </div>
      ) : (
        <div className='grid gap-4 md:grid-cols-2'>
          <TextField
            id='booking-company'
            name='providerName'
            label='Rental company'
            maxLength={PROVIDER_NAME_MAX_LENGTH}
            error={error('providerName')}
            defaultValue={value('providerName')}
          />
          <RatePlanField kind={kind} error={error('ratePlan')} defaultValue={value('ratePlan')} />
          <TextField
            id='booking-pick-up'
            name='origin'
            label='Pick-up'
            hint='Airport code or city'
            maxLength={PLACE_MAX_LENGTH}
            error={error('origin')}
            defaultValue={value('origin')}
          />
          <TextField
            id='booking-drop-off'
            name='destination'
            label='Drop-off'
            hint='Leave blank if it’s the same place'
            maxLength={PLACE_MAX_LENGTH}
            error={error('destination')}
            defaultValue={value('destination')}
          />
          <DateField
            id='booking-pick-up-date'
            name='checkIn'
            label='Pick-up date'
            error={error('checkIn')}
            defaultValue={value('checkIn')}
          />
          <DateField
            id='booking-drop-off-date'
            name='checkOut'
            label='Drop-off date'
            error={error('checkOut')}
            defaultValue={value('checkOut')}
          />
        </div>
      )}

      <div className='grid gap-4 border-t border-line pt-6 md:grid-cols-2'>
        <MoneyInput
          id='booking-paid'
          name='paidCents'
          label='What you paid'
          hint='The total for everyone on the booking'
          currency={bookingCurrency}
          required
          error={error('paidCents')}
          defaultValue={paid ? Number(paid) : undefined}
        />
        {kind === 'car' ? (
          <input type='hidden' name='travelers' value='1' />
        ) : (
          <TextField
            id='booking-travelers'
            name='travelers'
            type='number'
            inputMode='numeric'
            min={1}
            max={MAX_TRAVELERS}
            label={kind === 'hotel' ? 'Guests' : 'Travelers'}
            error={error('travelers')}
            defaultValue={value('travelers') ?? '1'}
          />
        )}
        <TextField
          id='booking-confirmation'
          name='confirmationCode'
          label='Confirmation code'
          autoCapitalize='characters'
          autoComplete='off'
          maxLength={CONFIRMATION_CODE_MAX_LENGTH}
          error={error('confirmationCode')}
          defaultValue={value('confirmationCode')}
        />
        {kind === 'car' ? null : (
          <TextField
            id='booking-provider'
            name='providerName'
            label='Booked through'
            hint={`A travel site, if you didn’t book with the ${kind === 'flight' ? 'airline' : 'hotel'}`}
            maxLength={PROVIDER_NAME_MAX_LENGTH}
            error={error('providerName')}
            defaultValue={value('providerName')}
          />
        )}
        {booking || draft ? (
          <SelectField id='booking-status' name='status' label='Status' error={error('status')} defaultValue={value('status') ?? 'booked'}>
            {BOOKING_STATUSES.map(status => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </SelectField>
        ) : null}
        <CheckboxField
          id='booking-watch'
          name='watchEnabled'
          label='Watch for price drops'
          hint='Checked every morning. You get an email only when a lower price is verified and you can act on it.'
          defaultChecked={checked('watchEnabled', true)}
          className='md:col-span-2'
        />
      </div>

      <div className='flex flex-col gap-3 md:flex-row md:items-center'>
        <Button type='submit' disabled={pending}>
          {pending ? 'Saving…' : draft ? 'Save booking' : booking ? 'Save changes' : 'Add booking'}
        </Button>
        <Button asChild variant='outline'>
          <Link href={draft ? REVIEW_PATH : booking ? `/travel/bookings/${booking.id}` : '/travel/bookings'}>Cancel</Link>
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

/** What the model couldn't read, shown on the field before the person saves. */
function draftProblem(draft: { booking: DraftFormDefaults; problems: Partial<Record<string, string[]>> }, field: string) {
  if (field === 'paidCents' && draft.booking.paidCents === null) return 'The email didn’t say. Enter what you paid.'
  return draft.problems[field]?.[0]
}

function RatePlanField({ kind, error, defaultValue }: { kind: Kind; error?: string; defaultValue?: string }) {
  return (
    <SelectField id='booking-rate-plan' name='ratePlan' label='Rate' error={error} defaultValue={defaultValue ?? ''}>
      <option value='' disabled>
        Choose a rate
      </option>
      {RATE_PLANS.map(plan => (
        <option key={plan} value={plan}>
          {ratePlanLabel(plan, kind)}
        </option>
      ))}
    </SelectField>
  )
}

type LabelledProps = { id: string; label: string; hint?: string; error?: string }

function TextField({ id, label, hint, error, ...props }: LabelledProps & ComponentProps<typeof Input>) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <Input id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error, hint)} {...props} />
    </Field>
  )
}

function SelectField({
  id,
  label,
  hint,
  error,
  children,
  ...props
}: LabelledProps & ComponentProps<typeof NativeSelect> & { children: ReactNode }) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <NativeSelect id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error, hint)} {...props}>
        {children}
      </NativeSelect>
    </Field>
  )
}

function CheckboxField({
  id,
  name,
  label,
  hint,
  defaultChecked,
  className,
}: {
  id: string
  name: string
  label: string
  hint?: string
  defaultChecked: boolean
  className?: string
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className='flex min-h-tap items-center gap-3 text-base'>
        <input
          id={id}
          name={name}
          type='checkbox'
          defaultChecked={defaultChecked}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className='size-5 shrink-0 accent-ink'
        />
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className='pl-8 text-sm text-ink-muted'>
          {hint}
        </p>
      ) : null}
    </div>
  )
}
