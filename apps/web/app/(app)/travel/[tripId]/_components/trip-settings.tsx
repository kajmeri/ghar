'use client'

import { deleteTrip, updateTrip, type Person, type Trip } from '@ghar/contracts'
import { comparePeople, personLabel } from '@ghar/core/people'
import { parseMoneyInput } from '@ghar/core/money'
import { statusAfterDateChange, TRIP_STATUSES, type TripStatus } from '@ghar/core/trips'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import { CheckboxField } from '@/app/(app)/_components/ui/checkbox-field'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'
import { TRIP_STATUS_LABELS } from '@/lib/travel/display'

/**
 * Editing the trip itself. Mostly this is where an idea gets its dates, which is the
 * moment it stops being an idea, so the status follows along unless you set it yourself.
 */
export function TripSettings({ trip, people, currentUserId }: { trip: Trip; people: Person[]; currentUserId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [budgetError, setBudgetError] = useState<string | null>(null)

  const save = useMutation(async (form: FormData) => {
    const startsOn = formText(form, 'startsOn')
    const endsOn = formText(form, 'endsOn')
    const budget = formText(form, 'budget')

    await api.request(updateTrip, {
      params: { tripId: trip.id },
      body: {
        // Checkboxes send nothing when unticked, so the roster is whatever is ticked now.
        travellerIds: form.getAll('travellerIds').filter(id => typeof id === 'string'),
        international: form.get('international') === 'on',
        name: formText(form, 'name'),
        destination: formText(form, 'destination') || null,
        status: statusAfterDateChange(trip.status, formText(form, 'status') as TripStatus, startsOn || null),
        notes: formText(form, 'notes') || null,
        budgetCents: budget === '' ? null : parseMoneyInput(budget),
        // Dates move together, as they do on the table.
        startsOn: startsOn || null,
        endsOn: endsOn || startsOn || null,
      },
    })
    setOpen(false)
  })

  const remove = useMutation(async () => {
    await api.request(deleteTrip, { params: { tripId: trip.id } })
    router.push('/travel')
  })

  // Each of these swaps one control for another in place. Focus goes with the swap, so a
  // keyboard or screen reader user isn't dropped back at the top of the page.
  const editRef = useRef<HTMLButtonElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const keepRef = useRef<HTMLButtonElement>(null)
  const deleteRef = useRef<HTMLButtonElement>(null)
  const consequenceId = useId()
  const wasOpen = useRef(open)
  const wasConfirming = useRef(confirmingDelete)

  useEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) nameRef.current?.focus()
    else editRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (wasConfirming.current === confirmingDelete) return
    wasConfirming.current = confirmingDelete
    if (confirmingDelete) keepRef.current?.focus()
    else deleteRef.current?.focus()
  }, [confirmingDelete])

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBudgetError(null)
    const form = new FormData(event.currentTarget)

    const budget = formText(form, 'budget')
    if (budget !== '') {
      try {
        parseMoneyInput(budget)
      } catch {
        setBudgetError('Write the budget as an amount, like 2,400 or 2400.00')
        return
      }
    }
    save.mutate(form)
  }

  if (!open) {
    return (
      <Button
        ref={editRef}
        variant='ghost'
        onClick={() => {
          setOpen(true)
        }}
      >
        Edit trip
      </Button>
    )
  }

  return (
    <Card className='w-full p-4 md:p-5'>
      <form onSubmit={onSubmit} className='flex flex-col gap-4'>
        <h2 className='text-base font-semibold'>Edit trip</h2>

        <div className='grid gap-4 md:grid-cols-2'>
          <Field label='Name'>
            <Input ref={nameRef} name='name' required maxLength={200} defaultValue={trip.name} />
          </Field>
          <Field label='Destination'>
            <Input name='destination' maxLength={200} defaultValue={trip.destination ?? ''} />
          </Field>
          <Field label='Leaves'>
            <Input name='startsOn' type='date' defaultValue={trip.startsOn ?? ''} />
          </Field>
          <Field label='Comes back'>
            <Input name='endsOn' type='date' defaultValue={trip.endsOn ?? ''} />
          </Field>
          <Field label='Status'>
            <Select name='status' defaultValue={trip.status}>
              {TRIP_STATUSES.map(status => (
                <option key={status} value={status}>
                  {TRIP_STATUS_LABELS[status]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label='Budget' hint='Leave it empty if you have not set one.'>
            <Input name='budget' inputMode='decimal' defaultValue={trip.budgetCents === null ? '' : String(trip.budgetCents / 100)} />
          </Field>
          <Field label='Notes' className='md:col-span-2'>
            <Textarea name='notes' rows={3} maxLength={4000} defaultValue={trip.notes ?? ''} />
          </Field>

          <fieldset className='md:col-span-2'>
            <legend className='text-sm font-medium'>Who is going</legend>
            <div className='mt-2 flex flex-wrap gap-x-5 gap-y-2'>
              {[...people].sort(comparePeople(currentUserId)).map(person => (
                <label key={person.id} className='flex min-h-tap items-center gap-2'>
                  <input
                    type='checkbox'
                    name='travellerIds'
                    value={person.id}
                    defaultChecked={trip.travellerIds.includes(person.id)}
                    className='size-5 accent-ink'
                  />
                  {personLabel(person, currentUserId)}
                </label>
              ))}
            </div>
            <p className='mt-1 text-xs text-ink-muted'>
              Someone missing, like a child without an account?{' '}
              <Link href='/settings/household#people' className='underline underline-offset-4'>
                Add them to the household
              </Link>
            </p>
          </fieldset>

          <div className='md:col-span-2'>
            <CheckboxField
              name='international'
              defaultChecked={trip.international}
              label='Leaving the country'
              hint='Checks that everyone going has a passport that lasts the trip.'
            />
          </div>
        </div>

        <FormError>{budgetError ?? save.error ?? remove.error}</FormError>

        <div className='flex flex-wrap items-center gap-2'>
          <Button type='submit' disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save changes'}
          </Button>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setOpen(false)
            }}
          >
            Cancel
          </Button>

          <div className='ml-auto flex items-center gap-2'>
            {confirmingDelete ? (
              <>
                <p id={consequenceId} className='text-sm text-ink-muted'>
                  This removes the itinerary and packing list. Bookings and charges stay.
                </p>
                <Button
                  type='button'
                  variant='destructive'
                  aria-describedby={consequenceId}
                  disabled={remove.pending}
                  onClick={() => {
                    remove.mutate()
                  }}
                >
                  {remove.pending ? 'Deleting…' : 'Delete it'}
                </Button>
                <Button
                  ref={keepRef}
                  type='button'
                  variant='ghost'
                  aria-describedby={consequenceId}
                  onClick={() => {
                    setConfirmingDelete(false)
                  }}
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                ref={deleteRef}
                type='button'
                variant='ghost'
                onClick={() => {
                  setConfirmingDelete(true)
                }}
              >
                Delete trip
              </Button>
            )}
          </div>
        </div>
      </form>
    </Card>
  )
}
