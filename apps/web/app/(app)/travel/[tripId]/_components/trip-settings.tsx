'use client'

import { deleteTrip, updateTrip, type HouseholdMember, type Trip } from '@ghar/contracts'
import { compareMembers, memberLabel } from '@ghar/core/household'
import { parseMoneyInput } from '@ghar/core/money'
import { TRIP_STATUSES, type TripStatus } from '@ghar/core/trips'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field, Input, Select, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

const STATUS_LABEL: Record<TripStatus, string> = {
  idea: 'Idea',
  planned: 'Planned',
  booked: 'Booked',
  past: 'Past',
}

/**
 * Editing the trip itself. Mostly this is where an idea gets its dates, which is the
 * moment it stops being an idea, so the status follows along unless you set it yourself.
 */
export function TripSettings({ trip, members, currentUserId }: { trip: Trip; members: HouseholdMember[]; currentUserId: string }) {
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
        memberUserIds: form.getAll('memberUserIds').filter(id => typeof id === 'string'),
        name: formText(form, 'name'),
        destination: formText(form, 'destination') || null,
        status: formText(form, 'status') as TripStatus,
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
        <p className='text-base font-semibold'>Edit trip</p>

        <div className='grid gap-4 md:grid-cols-2'>
          <Field label='Name'>
            <Input name='name' required maxLength={200} defaultValue={trip.name} />
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
                  {STATUS_LABEL[status]}
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
              {[...members].sort(compareMembers(currentUserId)).map(member => (
                <label key={member.userId} className='flex min-h-tap items-center gap-2'>
                  <input
                    type='checkbox'
                    name='memberUserIds'
                    value={member.userId}
                    defaultChecked={trip.memberUserIds.includes(member.userId)}
                    className='size-5 accent-ink'
                  />
                  {memberLabel(member, currentUserId)}
                </label>
              ))}
            </div>
            <p className='mt-1 text-xs text-ink-muted'>
              Names come from your household.{' '}
              <Link href='/household' className='underline underline-offset-4'>
                Change them
              </Link>
            </p>
          </fieldset>
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
                <p className='text-sm text-ink-muted'>This removes the itinerary and packing list. Bookings and charges stay.</p>
                <Button
                  type='button'
                  variant='destructive'
                  disabled={remove.pending}
                  onClick={() => {
                    remove.mutate()
                  }}
                >
                  {remove.pending ? 'Deleting…' : 'Delete it'}
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => {
                    setConfirmingDelete(false)
                  }}
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button
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
