'use client'

import {
  createTripRoom,
  deleteTripRoom,
  placeTripPerson,
  ROOM_NAME_MAX,
  ROOM_SLEEPS_LIMIT,
  updateTripRoom,
  type TripRoom,
  type TripRoomPerson,
  type TripRoomsValue,
} from '@ghar/contracts'
import { roomFillText } from '@ghar/core/trip-rooms'
import { useRef, useState, type SyntheticEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { FormError } from '@/components/ui/form-error'
import { Input } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/native-select'
import { Pill } from '@/components/ui/pill'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { formText } from '@/lib/form'

// Who sleeps where. The household sets up the rooms and puts people in them; guests see the plan.
// A guest bringing others takes a bed for each of them.

const keyText = (person: TripRoomPerson['person']) => `${person.kind}:${person.id}`

function personName(person: TripRoomPerson): string {
  const name = person.you ? 'You' : (person.name ?? 'A guest')
  return person.heads > 1 ? `${name} +${String(person.heads - 1)}` : name
}

export function TripRooms({ tripId, value }: { tripId: string; value: TripRoomsValue }) {
  const everyone = [...value.rooms.flatMap(room => room.people), ...value.unplaced]
  const roomOf = new Map(value.rooms.flatMap(room => room.people.map(person => [keyText(person.person), room.id] as const)))

  // A guest with no rooms set up has nothing to see yet.
  if (!value.canManage && value.rooms.length === 0) return null

  return (
    <section aria-labelledby='rooms-heading' className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='rooms-heading' className='text-lg font-semibold'>
          Rooms
        </h2>
        <p className='text-sm text-ink-muted'>Who sleeps where.</p>
      </div>

      {value.rooms.length === 0 ? (
        <div className='rounded-card border border-dashed border-line px-4 py-6'>
          <p className='text-base font-medium'>No rooms yet</p>
          <p className='text-sm text-ink-muted'>Add the rooms where you’re staying, then put everyone in one. Guests see the plan.</p>
        </div>
      ) : (
        <ul className='grid gap-3 md:grid-cols-2'>
          {value.rooms.map(room => (
            <RoomCard key={room.id} tripId={tripId} room={room} canManage={value.canManage} />
          ))}
        </ul>
      )}

      {value.unplaced.length > 0 && value.rooms.length > 0 ? (
        <p className='text-sm text-ink-muted'>No room yet: {value.unplaced.map(personName).join(', ')}</p>
      ) : null}

      {value.canManage ? (
        <>
          {value.rooms.length > 0 && everyone.length > 0 ? (
            <div className='flex flex-col gap-1 rounded-card border border-line bg-surface p-4'>
              <h3 className='text-base font-semibold'>Put people in rooms</h3>
              <ul className='flex flex-col divide-y divide-line'>
                {everyone.map(person => (
                  <Placement
                    key={keyText(person.person)}
                    tripId={tripId}
                    person={person}
                    rooms={value.rooms}
                    roomId={roomOf.get(keyText(person.person)) ?? null}
                  />
                ))}
              </ul>
            </div>
          ) : null}
          <AddRoom tripId={tripId} />
        </>
      ) : null}
    </section>
  )
}

function RoomCard({ tripId, room, canManage }: { tripId: string; room: TripRoom; canManage: boolean }) {
  const [editing, setEditing] = useState(false)
  const remove = useMutation(() => api.request(deleteTripRoom, { params: { tripId, roomId: room.id } }))
  const fill = roomFillText(room.sleeps, room.heads)

  return (
    <li className='flex flex-col gap-2 rounded-card border border-line bg-surface p-4'>
      <div className='flex items-baseline justify-between gap-3'>
        <h3 className='text-base font-semibold break-words'>{room.name}</h3>
        {room.fill === 'over' ? (
          <Pill tone='negative'>{fill}</Pill>
        ) : room.fill === 'full' ? (
          <Pill>{fill}</Pill>
        ) : (
          <p className='shrink-0 text-sm text-ink-muted tabular-nums'>{fill}</p>
        )}
      </div>
      <p className='text-base'>
        {room.people.length === 0 ? <span className='text-ink-muted'>No one yet</span> : room.people.map(personName).join(', ')}
      </p>
      {canManage ? (
        editing ? (
          <EditRoom
            tripId={tripId}
            room={room}
            onDone={() => {
              setEditing(false)
            }}
          />
        ) : (
          <div className='flex flex-wrap gap-x-4'>
            <button
              type='button'
              onClick={() => {
                setEditing(true)
              }}
              className='min-h-tap text-sm text-ink underline underline-offset-2'
            >
              Change
            </button>
            <button
              type='button'
              disabled={remove.pending}
              onClick={() => {
                remove.mutate()
              }}
              className='min-h-tap text-sm text-ink-muted underline underline-offset-2 disabled:opacity-40'
            >
              {remove.pending ? 'Removing…' : 'Remove room'}
            </button>
          </div>
        )
      ) : null}
      <FormError>{remove.error}</FormError>
    </li>
  )
}

function RoomFields({ name, sleeps }: { name?: string; sleeps?: number }) {
  return (
    <div className='grid grid-cols-[1fr_6rem] gap-3'>
      <Field label='Room'>
        <Input name='name' required maxLength={ROOM_NAME_MAX} defaultValue={name} placeholder='Upstairs double' />
      </Field>
      <Field label='Sleeps'>
        <Input name='sleeps' type='number' inputMode='numeric' required min={1} max={ROOM_SLEEPS_LIMIT} defaultValue={sleeps ?? 2} />
      </Field>
    </div>
  )
}

function readRoom(form: HTMLFormElement) {
  const data = new FormData(form)
  return { name: formText(data, 'name'), sleeps: Number(formText(data, 'sleeps')) }
}

function EditRoom({ tripId, room, onDone }: { tripId: string; room: TripRoom; onDone: () => void }) {
  const save = useMutation(async (body: { name: string; sleeps: number }) => {
    await api.request(updateTripRoom, { params: { tripId, roomId: room.id }, body })
    onDone()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    save.mutate(readRoom(event.currentTarget))
  }

  return (
    <form onSubmit={onSubmit} className='flex flex-col gap-3 border-t border-line pt-3'>
      <RoomFields name={room.name} sleeps={room.sleeps} />
      <div className='flex gap-2'>
        <Button type='submit' disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save changes'}
        </Button>
        <Button type='button' variant='ghost' onClick={onDone}>
          Cancel
        </Button>
      </div>
      <FormError>{save.error}</FormError>
    </form>
  )
}

function AddRoom({ tripId }: { tripId: string }) {
  const form = useRef<HTMLFormElement>(null)
  const add = useMutation(async (body: { name: string; sleeps: number }) => {
    await api.request(createTripRoom, { params: { tripId }, body })
    form.current?.reset()
  })

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    add.mutate(readRoom(event.currentTarget))
  }

  return (
    <form ref={form} onSubmit={onSubmit} className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
      <h3 className='text-base font-semibold'>Add a room</h3>
      <RoomFields />
      <Button type='submit' disabled={add.pending} className='self-start'>
        {add.pending ? 'Adding…' : 'Add room'}
      </Button>
      <FormError>{add.error}</FormError>
    </form>
  )
}

function Placement({
  tripId,
  person,
  rooms,
  roomId,
}: {
  tripId: string
  person: TripRoomPerson
  rooms: TripRoom[]
  roomId: string | null
}) {
  const place = useMutation((next: string | null) =>
    api.request(placeTripPerson, { params: { tripId }, body: { person: person.person, roomId: next } })
  )
  const id = `place-${keyText(person.person)}`

  return (
    <li className='flex flex-col gap-1 py-2'>
      <div className='flex items-center justify-between gap-3'>
        <label htmlFor={id} className='min-w-0 text-base break-words'>
          {personName(person)}
        </label>
        <NativeSelect
          id={id}
          className='w-44 shrink-0'
          value={roomId ?? ''}
          disabled={place.pending}
          onChange={event => {
            place.mutate(event.target.value === '' ? null : event.target.value)
          }}
        >
          <option value=''>No room</option>
          {rooms.map(room => (
            <option key={room.id} value={room.id}>
              {room.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <FormError>{place.error}</FormError>
    </li>
  )
}
