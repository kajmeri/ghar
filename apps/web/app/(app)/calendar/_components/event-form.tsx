'use client'

import type { Member } from '@ghar/contracts'
import {
  EVENT_COLOR_TOKENS,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_TITLE_MAX_LENGTH,
  MAX_RECURRENCE_COUNT,
  MAX_RECURRENCE_INTERVAL,
  type Weekday,
} from '@ghar/core/calendar'
import Link from 'next/link'
import { useActionState, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { DateField } from '@/app/(app)/_components/ui/date-field'
import { Button } from '@/components/ui/button'
import { describedBy, Field, FormMessage } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { useFocusFirstInvalid } from '@/hooks/use-focus-first-invalid'
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state'
import {
  CATEGORY_LABELS,
  COLOR_LABELS,
  ENDS_CHOICES,
  ENDS_LABELS,
  memberName,
  PICKABLE_CATEGORIES,
  REPEAT_CHOICES,
  REPEAT_LABELS,
  REPEAT_UNITS,
  TONE_DOT,
  type EndsChoice,
  type RepeatChoice,
} from '@/lib/calendar/display'
import type { EventFormDefaults } from '@/lib/calendar/form-defaults'
import { cn } from '@/lib/utils'
import { createEventAction, updateEventAction } from '../actions'

const DATETIME_CLASS =
  'block appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left'

const PILL =
  'flex min-h-tap items-center justify-center gap-2 rounded-control border border-line bg-surface px-2 text-center text-base hover:border-ink/40 has-checked:border-ink has-checked:bg-ink has-checked:text-paper has-focus-visible:ring-2 has-focus-visible:ring-ring has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-surface'

const LEGEND = 'mb-1.5 text-sm font-medium text-ink'

/** Sunday first, like the month grid. */
const WEEKDAY_OPTIONS: { value: Weekday; short: string; long: string }[] = [
  { value: 'SU', short: 'Sun', long: 'Sunday' },
  { value: 'MO', short: 'Mon', long: 'Monday' },
  { value: 'TU', short: 'Tue', long: 'Tuesday' },
  { value: 'WE', short: 'Wed', long: 'Wednesday' },
  { value: 'TH', short: 'Thu', long: 'Thursday' },
  { value: 'FR', short: 'Fri', long: 'Friday' },
  { value: 'SA', short: 'Sat', long: 'Saturday' },
]

type ValueField =
  | 'title'
  | 'startDate'
  | 'endDate'
  | 'startsAt'
  | 'endsAt'
  | 'interval'
  | 'endsOn'
  | 'endsAfter'
  | 'category'
  | 'colorToken'
  | 'location'
  | 'description'

function toggled<T>(list: readonly T[], item: T, on: boolean): T[] {
  if (!on) return list.filter(entry => entry !== item)
  return list.includes(item) ? [...list] : [...list, item]
}

/** Adds an event, or edits one when `event.id` is set. Changes to a repeating event apply to all. */
export function EventForm({
  event,
  members,
  timeZone,
  cancelHref,
}: {
  event: EventFormDefaults
  members: Member[]
  timeZone: string
  cancelHref: string
}) {
  const editing = event.id !== null
  const [state, formAction, pending] = useActionState(editing ? updateEventAction : createEventAction, IDLE)
  const formRef = useRef<HTMLFormElement>(null)
  useFocusFirstInvalid(formRef, state)
  // Controlled so they survive the form reset after a submit that needs fixing.
  const [allDay, setAllDay] = useState(event.allDay)
  const [repeat, setRepeat] = useState<RepeatChoice>(event.repeat)
  const [ends, setEnds] = useState<EndsChoice>(event.ends)
  const [weekdays, setWeekdays] = useState<Weekday[]>(event.weekdays)
  const [attendeeIds, setAttendeeIds] = useState<string[]>(event.attendeeIds)
  const error = (field: string) => fieldError(state, field)

  /** What was just submitted if it needs fixing, else the event's own value. */
  function value(field: ValueField): string {
    const submitted = submittedValue(state, field)
    if (submitted !== undefined) return submitted
    const initial = event[field]
    return initial === null ? '' : String(initial)
  }

  const repeatChoices = REPEAT_CHOICES.filter(choice => choice !== 'custom' || event.repeat === 'custom')
  const categories = PICKABLE_CATEGORIES.includes(event.category) ? PICKABLE_CATEGORIES : [...PICKABLE_CATEGORIES, event.category]

  return (
    <form ref={formRef} action={formAction} noValidate className='flex flex-col gap-6 rounded-card border border-line bg-surface p-4 md:p-6'>
      {event.id !== null ? <input type='hidden' name='eventId' value={event.id} /> : null}

      <TextField
        id='event-title'
        name='title'
        label='Name'
        autoComplete='off'
        maxLength={EVENT_TITLE_MAX_LENGTH}
        error={error('title')}
        defaultValue={value('title')}
      />

      <div className='flex flex-col gap-4 border-t border-line pt-6'>
        <label className='flex min-h-tap items-center gap-3 self-start text-base'>
          <input
            type='checkbox'
            name='allDay'
            checked={allDay}
            onChange={change => {
              setAllDay(change.target.checked)
            }}
            className='size-5 shrink-0 accent-ink'
          />
          All day
        </label>
        {allDay ? (
          <div className='grid gap-4 md:grid-cols-2'>
            <DateField
              id='event-start-date'
              name='startDate'
              label='First day'
              error={error('startDate')}
              defaultValue={value('startDate')}
            />
            <DateField
              id='event-end-date'
              name='endDate'
              label='Last day'
              hint='The same as the first day for a one-day event'
              error={error('endDate')}
              defaultValue={value('endDate')}
            />
          </div>
        ) : (
          <div className='grid gap-4 md:grid-cols-2'>
            <TextField
              id='event-starts'
              name='startsAt'
              type='datetime-local'
              label='Starts'
              hint={`In ${timeZone}`}
              className={DATETIME_CLASS}
              error={error('startsAt')}
              defaultValue={value('startsAt')}
            />
            <TextField
              id='event-ends'
              name='endsAt'
              type='datetime-local'
              label='Ends'
              className={DATETIME_CLASS}
              error={error('endsAt')}
              defaultValue={value('endsAt')}
            />
          </div>
        )}
      </div>

      <div className='flex flex-col gap-4 border-t border-line pt-6'>
        <SelectField
          id='event-repeat'
          name='repeat'
          label='Repeats'
          value={repeat}
          onChange={change => {
            setRepeat(change.target.value as RepeatChoice)
          }}
          className='md:max-w-sm'
        >
          {repeatChoices.map(choice => (
            <option key={choice} value={choice}>
              {REPEAT_LABELS[choice]}
            </option>
          ))}
        </SelectField>

        {repeat === 'custom' ? (
          <>
            <input type='hidden' name='rrule' value={event.rrule ?? ''} />
            <p className='text-sm text-ink-muted'>
              {event.recurrence ?? 'This event repeats by a rule set outside Ghar.'} Pick another option to replace it.
            </p>
          </>
        ) : repeat === 'none' ? null : (
          <>
            <TextField
              id='event-interval'
              name='interval'
              type='number'
              inputMode='numeric'
              min={1}
              max={MAX_RECURRENCE_INTERVAL}
              label={`Every how many ${REPEAT_UNITS[repeat]}`}
              error={error('interval')}
              defaultValue={value('interval')}
              className='md:max-w-40'
            />
            {repeat === 'weekly' ? (
              <fieldset aria-describedby={['event-weekdays-hint', error('rrule') ? 'event-rrule-error' : null].filter(Boolean).join(' ')}>
                <legend className={LEGEND}>On</legend>
                <div className='grid grid-cols-4 gap-2 sm:grid-cols-7'>
                  {WEEKDAY_OPTIONS.map(day => (
                    <label key={day.value} className={PILL}>
                      <input
                        type='checkbox'
                        name='weekdays'
                        value={day.value}
                        checked={weekdays.includes(day.value)}
                        onChange={change => {
                          setWeekdays(toggled(weekdays, day.value, change.target.checked))
                        }}
                        className='sr-only'
                      />
                      <span aria-hidden>{day.short}</span>
                      <span className='sr-only'>{day.long}</span>
                    </label>
                  ))}
                </div>
                <p id='event-weekdays-hint' className='mt-1.5 text-sm text-ink-muted'>
                  Leave them all off to repeat on the day it starts.
                </p>
              </fieldset>
            ) : null}
            <fieldset aria-describedby={error('rrule') ? 'event-rrule-error' : undefined}>
              <legend className={LEGEND}>Stops</legend>
              <div className='grid grid-cols-3 gap-2'>
                {ENDS_CHOICES.map(choice => (
                  <label key={choice} className={PILL}>
                    <input
                      type='radio'
                      name='ends'
                      value={choice}
                      checked={ends === choice}
                      onChange={() => {
                        setEnds(choice)
                      }}
                      className='sr-only'
                    />
                    {ENDS_LABELS[choice]}
                  </label>
                ))}
              </div>
            </fieldset>
            {ends === 'on' ? (
              <DateField
                id='event-ends-on'
                name='endsOn'
                label='Last date it happens'
                error={error('endsOn')}
                defaultValue={value('endsOn')}
                className='md:max-w-sm'
              />
            ) : ends === 'after' ? (
              <TextField
                id='event-ends-after'
                name='endsAfter'
                type='number'
                inputMode='numeric'
                min={1}
                max={MAX_RECURRENCE_COUNT}
                label='How many times it happens'
                error={error('endsAfter')}
                defaultValue={value('endsAfter')}
                className='md:max-w-40'
              />
            ) : null}
          </>
        )}
        {error('rrule') ? (
          <p id='event-rrule-error' role='alert' className='text-sm text-negative'>
            {error('rrule')}
          </p>
        ) : null}
      </div>

      <div className='flex flex-col gap-6 border-t border-line pt-6'>
        <fieldset>
          <legend className={LEGEND}>Category</legend>
          <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
            {categories.map(category => (
              <label key={category} className={PILL}>
                <input type='radio' name='category' value={category} defaultChecked={value('category') === category} className='sr-only' />
                {CATEGORY_LABELS[category]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset aria-describedby='event-color-hint'>
          <legend className={LEGEND}>Color</legend>
          <div className='grid grid-cols-2 gap-2 md:grid-cols-4'>
            <label className={PILL}>
              <input type='radio' name='colorToken' value='' defaultChecked={value('colorToken') === ''} className='sr-only' />
              None
            </label>
            {EVENT_COLOR_TOKENS.map(token => (
              <label key={token} className={PILL}>
                <input type='radio' name='colorToken' value={token} defaultChecked={value('colorToken') === token} className='sr-only' />
                <span aria-hidden className={cn('size-2.5 shrink-0 rounded-pill', TONE_DOT[token])} />
                {COLOR_LABELS[token]}
              </label>
            ))}
          </div>
          <p id='event-color-hint' className='mt-1.5 text-sm text-ink-muted'>
            Only when it means something. Most events need none.
          </p>
        </fieldset>

        <div className='grid gap-4 md:grid-cols-2'>
          <TextField
            id='event-location'
            name='location'
            label='Where'
            autoComplete='off'
            maxLength={EVENT_LOCATION_MAX_LENGTH}
            error={error('location')}
            defaultValue={value('location')}
            className='md:col-span-2'
          />
          <Field id='event-description' label='Notes' error={error('description')} className='md:col-span-2'>
            <textarea
              id='event-description'
              name='description'
              rows={4}
              maxLength={EVENT_DESCRIPTION_MAX_LENGTH}
              defaultValue={value('description')}
              aria-invalid={Boolean(error('description'))}
              aria-describedby={describedBy('event-description', error('description'))}
              className='block w-full min-w-0 rounded-control border border-input bg-surface px-3 py-2.5 text-base text-ink placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden aria-invalid:border-negative'
            />
          </Field>
        </div>
      </div>

      {members.length > 0 ? (
        <fieldset className='border-t border-line pt-6' aria-describedby={error('attendeeIds') ? 'event-attendees-error' : undefined}>
          <legend className='sr-only'>Who’s going</legend>
          <p aria-hidden className={LEGEND}>
            Who’s going
          </p>
          <div className='grid gap-x-4 md:grid-cols-2'>
            {members.map(member => (
              <label key={member.userId} className='flex min-h-tap items-center gap-3 text-base'>
                <input
                  type='checkbox'
                  name='attendeeIds'
                  value={member.userId}
                  checked={attendeeIds.includes(member.userId)}
                  onChange={change => {
                    setAttendeeIds(toggled(attendeeIds, member.userId, change.target.checked))
                  }}
                  className='size-5 shrink-0 accent-ink'
                />
                <span className='min-w-0 break-words'>{memberName(member)}</span>
              </label>
            ))}
          </div>
          {error('attendeeIds') ? (
            <p id='event-attendees-error' role='alert' className='mt-1.5 text-sm text-negative'>
              {error('attendeeIds')}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <div className='flex flex-col gap-3 md:flex-row md:items-center'>
        <Button type='submit' disabled={pending}>
          {pending ? 'Saving…' : editing ? 'Save changes' : 'Add event'}
        </Button>
        <Button asChild variant='outline'>
          <Link href={cancelHref}>Cancel</Link>
        </Button>
        <FormMessage state={state} />
      </div>
    </form>
  )
}

type LabelledProps = { id: string; label: string; hint?: string; error?: string }

function TextField({ id, label, hint, error, className, ...props }: LabelledProps & ComponentProps<typeof Input>) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <Input
        id={id}
        aria-invalid={Boolean(error)}
        aria-describedby={describedBy(id, error, hint)}
        className={className?.includes('appearance-none') ? DATETIME_CLASS : undefined}
        {...props}
      />
    </Field>
  )
}

function SelectField({
  id,
  label,
  hint,
  error,
  className,
  children,
  ...props
}: LabelledProps & ComponentProps<typeof NativeSelect> & { children: ReactNode }) {
  return (
    <Field id={id} label={label} hint={hint} error={error} className={className}>
      <NativeSelect id={id} aria-invalid={Boolean(error)} aria-describedby={describedBy(id, error, hint)} {...props}>
        {children}
      </NativeSelect>
    </Field>
  )
}
