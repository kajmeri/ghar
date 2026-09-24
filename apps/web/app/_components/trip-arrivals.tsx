'use client'

import {
  ARRIVAL_NUMBER_MAX,
  ARRIVAL_PASTE_MAX,
  ARRIVAL_PLACE_MAX,
  arrivalModeSchema,
  deleteTripArrival,
  readTripArrival,
  saveTripArrival,
  setArrivalRide,
  type ArrivalDraftValue,
  type TripArrival,
  type TripArrivalPerson,
  type TripArrivalsValue,
} from '@ghar/contracts'
import { formatInstant, instantFromWallClock, isWallClock, toCalendarDate, toWallClock } from '@ghar/core/dates'
import { ARRIVAL_MODE_LABELS, ARRIVAL_MODES } from '@ghar/core/trip-arrivals'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field, Textarea } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Pill } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api, errorMessage, type BodyOf } from '@/lib/api/client'
import { formText } from '@/lib/form'

// When everyone gets there and leaves, and who's picking them up. Each person fills in their own,
// by hand or by pasting a confirmation to be read; the household fills in its travellers. Anyone
// on the trip can offer a ride. Times are the trip's, like the rest of the plan.

type Direction = 'arriving' | 'leaving'
type Drafts = { arriving: ArrivalDraftValue | null; leaving: ArrivalDraftValue | null }

const DATETIME_CLASS =
  'block appearance-none [&::-webkit-calendar-picker-indicator]:opacity-60 [&::-webkit-date-and-time-value]:min-h-6 [&::-webkit-date-and-time-value]:text-left'

const keyText = (person: TripArrivalPerson['person']) => `${person.kind}:${person.id}`

export function TripArrivals({ tripId, value, timeZone }: { tripId: string; value: TripArrivalsValue; timeZone: string }) {
  const editable = value.people.filter(person => person.canEdit)
  const arrived = new Set(value.arrivals.filter(arrival => arrival.direction === 'arriving').map(arrival => keyText(arrival.person)))
  const missing = value.people.filter(person => !arrived.has(keyText(person.person)))

  return (
    <section aria-labelledby='arrivals-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='arrivals-heading' className='text-lg font-semibold'>
          Getting there
        </h2>
        <p className='text-sm text-ink-muted'>When everyone lands and leaves, and who’s picking them up. Times are in {timeZone}.</p>
      </div>

      {value.arrivals.length === 0 ? (
        <div className='rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>No one’s added their travel yet</p>
          <p className='text-sm text-ink-muted'>
            {editable.length > 0
              ? 'Add when you get in and when you leave, so people can plan pickups.'
              : 'Arrivals show up here as people add them.'}
          </p>
        </div>
      ) : (
        <Board tripId={tripId} arrivals={value.arrivals} timeZone={timeZone} />
      )}

      {missing.length > 0 && value.arrivals.length > 0 ? (
        <p className='text-sm text-ink-muted'>Still to add: {missing.map(person => person.name ?? 'A guest').join(', ')}</p>
      ) : null}

      {editable.length > 0 ? (
        <Editor tripId={tripId} people={editable} arrivals={value.arrivals} canRead={value.canRead} timeZone={timeZone} />
      ) : null}
    </section>
  )
}

function Board({ tripId, arrivals, timeZone }: { tripId: string; arrivals: TripArrival[]; timeZone: string }) {
  const days = new Map<string, TripArrival[]>()
  for (const arrival of arrivals) {
    const day = toCalendarDate(new Date(arrival.at), timeZone)
    days.set(day, [...(days.get(day) ?? []), arrival])
  }

  return (
    <div className='flex flex-col gap-3'>
      {[...days].map(([day, list]) => {
        const first = list[0]
        const heading = first ? formatInstant(new Date(first.at), timeZone, { weekday: 'long', month: 'short', day: 'numeric' }) : day
        return (
          <div key={day} className='flex flex-col gap-1.5'>
            <h3 className='text-sm font-medium text-ink-muted'>{heading}</h3>
            <ol className='flex flex-col divide-y divide-line rounded-card border border-line bg-surface px-4'>
              {list.map(arrival => (
                <ArrivalRow key={arrival.id} tripId={tripId} arrival={arrival} timeZone={timeZone} />
              ))}
            </ol>
          </div>
        )
      })}
    </div>
  )
}

function ArrivalRow({ tripId, arrival, timeZone }: { tripId: string; arrival: TripArrival; timeZone: string }) {
  const ride = useMutation((offer: boolean) => api.request(setArrivalRide, { params: { tripId, arrivalId: arrival.id }, body: { offer } }))
  const time = formatInstant(new Date(arrival.at), timeZone, { hour: 'numeric', minute: '2-digit' })
  const who = arrival.you ? 'You' : (arrival.name ?? 'A guest')
  const pickup = arrival.direction === 'arriving'
  const how = [
    ARRIVAL_MODE_LABELS[arrival.mode],
    arrival.number,
    arrival.place && `${arrival.direction === 'arriving' ? 'into' : 'from'} ${arrival.place}`,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <li className='flex flex-col gap-1 py-3'>
      <div className='flex items-baseline justify-between gap-3'>
        <p className='text-base'>
          <span className='font-medium'>{who}</span>{' '}
          <span className='text-ink-muted'>{pickup ? (arrival.you ? 'arrive' : 'arrives') : arrival.you ? 'leave' : 'leaves'}</span>
        </p>
        <p className='shrink-0 text-base font-medium tabular-nums'>{time}</p>
      </div>
      <div className='flex flex-wrap items-center justify-between gap-x-3 gap-y-1'>
        <p className='text-sm break-words text-ink-muted'>{how}</p>
        {arrival.ride === 'wanted' ? (
          <Pill tone='caution'>Needs a ride</Pill>
        ) : arrival.ride === 'arranged' ? (
          <Pill tone='positive'>
            {arrival.rideMine ? (pickup ? 'You’re picking them up' : 'You’re taking them') : `Ride with ${arrival.rideBy ?? 'someone'}`}
          </Pill>
        ) : null}
      </div>
      {arrival.canOfferRide || arrival.canCancelRide ? (
        <button
          type='button'
          disabled={ride.pending}
          onClick={() => {
            ride.mutate(arrival.canOfferRide)
          }}
          className='min-h-tap w-fit text-sm text-ink underline underline-offset-2 disabled:opacity-40'
        >
          {ride.pending
            ? 'Saving…'
            : arrival.canOfferRide
              ? pickup
                ? 'I’ll pick them up'
                : 'I’ll take them'
              : arrival.rideMine
                ? 'I can’t make it after all'
                : 'Take off the ride'}
        </button>
      ) : null}
      <FormError>{ride.error}</FormError>
    </li>
  )
}

function Editor({
  tripId,
  people,
  arrivals,
  canRead,
  timeZone,
}: {
  tripId: string
  people: TripArrivalPerson[]
  arrivals: TripArrival[]
  canRead: boolean
  timeZone: string
}) {
  const [who, setWho] = useState(() => keyText((people.find(person => person.you) ?? people[0])?.person ?? { kind: 'guest', id: '' }))
  const [drafts, setDrafts] = useState<Drafts>({ arriving: null, leaving: null })
  // Bumped when a read fills the forms, so they take the new values.
  const [filled, setFilled] = useState(0)
  const person = people.find(entry => keyText(entry.person) === who) ?? people[0]
  if (!person) return null
  const saved = (direction: Direction) =>
    arrivals.find(arrival => arrival.direction === direction && keyText(arrival.person) === keyText(person.person)) ?? null

  return (
    <div className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <h3 className='text-base font-semibold'>{people.length === 1 && person.you ? 'Your travel' : 'Add travel'}</h3>
      {people.length > 1 ? (
        <Field label='For'>
          <NativeSelect
            value={who}
            onChange={event => {
              setWho(event.target.value)
              setDrafts({ arriving: null, leaving: null })
            }}
          >
            {people.map(entry => (
              <option key={keyText(entry.person)} value={keyText(entry.person)}>
                {entry.you ? 'You' : (entry.name ?? 'A guest')}
              </option>
            ))}
          </NativeSelect>
        </Field>
      ) : null}

      {canRead ? (
        <Reader
          tripId={tripId}
          onRead={next => {
            setDrafts(next)
            setFilled(count => count + 1)
          }}
        />
      ) : null}

      {(['arriving', 'leaving'] as const).map(direction => (
        <LegForm
          key={`${who}-${direction}-${String(filled)}`}
          tripId={tripId}
          person={person}
          direction={direction}
          saved={saved(direction)}
          draft={drafts[direction]}
          timeZone={timeZone}
          onSaved={() => {
            setDrafts(current => ({ ...current, [direction]: null }))
          }}
        />
      ))}
    </div>
  )
}

function Reader({ tripId, onRead }: { tripId: string; onRead: (drafts: Drafts) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  // Reading saves nothing, so there's nothing to refresh: the forms below take the drafts.
  const read = async () => {
    setError(null)
    setNote(null)
    setPending(true)
    try {
      const { value } = await api.request(readTripArrival, { params: { tripId }, body: { text } })
      onRead(value)
      setText('')
      setNote('Check what we filled in below, then save.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setPending(false)
    }
  }

  return (
    <details className='group rounded-control border border-line'>
      <summary className='flex min-h-tap cursor-pointer items-center px-3 text-base'>Paste a confirmation</summary>
      <div className='flex flex-col gap-2 px-3 pb-3'>
        <Field label='Booking email or ticket' hint='We read the times and places. Nothing you paste is kept.'>
          <Textarea
            rows={4}
            maxLength={ARRIVAL_PASTE_MAX}
            value={text}
            onChange={event => {
              setText(event.target.value)
            }}
          />
        </Field>
        <Button
          type='button'
          variant='outline'
          disabled={pending || text.trim() === ''}
          onClick={() => {
            void read()
          }}
          className='self-start'
        >
          {pending ? 'Reading…' : 'Read it'}
        </Button>
        {note ? <p className='text-sm text-ink-muted'>{note}</p> : null}
        <FormError>{error}</FormError>
      </div>
    </details>
  )
}

function LegForm({
  tripId,
  person,
  direction,
  saved,
  draft,
  timeZone,
  onSaved,
}: {
  tripId: string
  person: TripArrivalPerson
  direction: Direction
  saved: TripArrival | null
  draft: ArrivalDraftValue | null
  timeZone: string
  onSaved: () => void
}) {
  const [timeError, setTimeError] = useState<string | undefined>(undefined)
  const save = useMutation(async (body: Omit<BodyOf<typeof saveTripArrival>, 'person' | 'direction'>) => {
    await api.request(saveTripArrival, { params: { tripId }, body: { ...body, person: person.person, direction } })
    onSaved()
  })
  const remove = useMutation(() =>
    saved ? api.request(deleteTripArrival, { params: { tripId, arrivalId: saved.id } }) : Promise.resolve()
  )
  const from = draft ?? saved
  const label = direction === 'arriving' ? 'Getting in' : 'Leaving'

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const at = formText(data, 'at')
    if (!isWallClock(at)) {
      setTimeError('Add the date and time.')
      return
    }
    setTimeError(undefined)
    save.mutate({
      mode: arrivalModeSchema.parse(formText(data, 'mode')),
      at: instantFromWallClock(at, timeZone).toISOString(),
      place: formText(data, 'place'),
      number: formText(data, 'number'),
      wantsRide: data.get('wantsRide') === 'on',
    })
  }

  return (
    <form onSubmit={onSubmit} className='flex flex-col gap-3 border-t border-line pt-3'>
      <div className='flex items-center justify-between gap-3'>
        <h4 className='text-base font-medium'>{label}</h4>
        {draft ? <Pill>From what you pasted</Pill> : saved ? <Pill>Saved</Pill> : null}
      </div>
      <div className='grid gap-3 md:grid-cols-2'>
        <Field label='By'>
          <NativeSelect name='mode' defaultValue={from?.mode ?? 'flight'}>
            {ARRIVAL_MODES.map(mode => (
              <option key={mode} value={mode}>
                {ARRIVAL_MODE_LABELS[mode]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={direction === 'arriving' ? 'Gets in' : 'Leaves'} error={timeError}>
          <Input
            name='at'
            type='datetime-local'
            className={DATETIME_CLASS}
            defaultValue={from ? toWallClock(new Date(from.at), timeZone) : ''}
          />
        </Field>
        <Field label={direction === 'arriving' ? 'Into' : 'From'} hint='An airport, station or address'>
          <Input name='place' maxLength={ARRIVAL_PLACE_MAX} defaultValue={from?.place ?? ''} />
        </Field>
        <Field label='Flight or train number'>
          <Input name='number' maxLength={ARRIVAL_NUMBER_MAX} defaultValue={from?.number ?? ''} autoCapitalize='characters' />
        </Field>
      </div>
      <label className='flex min-h-tap items-center gap-3 self-start text-base'>
        <input type='checkbox' name='wantsRide' defaultChecked={saved?.wantsRide ?? false} className='size-5 shrink-0 accent-ink' />
        {direction === 'arriving' ? 'Needs a pickup' : 'Needs a ride there'}
      </label>
      <div className='flex flex-wrap items-center gap-2'>
        <Button type='submit' disabled={save.pending}>
          {save.pending ? 'Saving…' : saved ? 'Save changes' : `Add ${direction === 'arriving' ? 'arrival' : 'departure'}`}
        </Button>
        {saved ? (
          <Button
            type='button'
            variant='ghost'
            disabled={remove.pending}
            onClick={() => {
              remove.mutate()
            }}
          >
            {remove.pending ? 'Removing…' : 'Remove'}
          </Button>
        ) : null}
      </div>
      <FormError>{save.error ?? remove.error}</FormError>
    </form>
  )
}
