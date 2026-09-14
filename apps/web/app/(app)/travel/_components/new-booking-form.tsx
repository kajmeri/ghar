'use client';

import { createBooking, type TripSummary } from '@casa/contracts';
import { BOOKING_KINDS, type BookingKind } from '@casa/core/itinerary';
import { instantInTimeZone } from '@casa/core/dates';
import { parseMoneyInput } from '@casa/core/money';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Select } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { useMutation } from '@/hooks/use-mutation';
import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';

const KIND_LABEL: Record<BookingKind, string> = {
  flight: 'Flight',
  lodging: 'Stay',
  car: 'Car',
  rail: 'Train',
  activity: 'Activity',
  other: 'Something else',
};

/**
 * A booking typed in by hand.
 *
 * Confirmations are meant to arrive on their own, parsed out of a forwarded email, but
 * that is a separate feature and this one cannot wait for it: without a way to put a
 * booking in, there is nothing to file under a trip.
 *
 * Date and time are typed separately, as a person reads them off a confirmation, and are
 * turned into an instant in the household's zone here.
 */
export function NewBookingForm({ trips, timeZone }: { trips: TripSummary[]; timeZone: string }) {
  const [open, setOpen] = useState(false);
  const [costError, setCostError] = useState<string | null>(null);

  const { mutate, pending, error } = useMutation(async (form: FormData) => {
    const cost = formText(form, 'cost');
    const startsOn = formText(form, 'startsOn');
    const startsAtTime = formText(form, 'startsAtTime');
    const endsOn = formText(form, 'endsOn');
    const endsAtTime = formText(form, 'endsAtTime');

    await api.request(createBooking, {
      body: {
        kind: formText(form, 'kind') as BookingKind,
        title: formText(form, 'title'),
        provider: formText(form, 'provider') || null,
        confirmationCode: formText(form, 'confirmationCode') || null,
        origin: formText(form, 'origin') || null,
        destination: formText(form, 'destination') || null,
        costCents: cost === '' ? null : parseMoneyInput(cost),
        tripId: formText(form, 'tripId') || null,
        startsAt:
          startsOn === ''
            ? null
            : instantInTimeZone(startsOn, startsAtTime || '00:00', timeZone).toISOString(),
        endsAt:
          endsOn === ''
            ? null
            : instantInTimeZone(endsOn, endsAtTime || '00:00', timeZone).toISOString(),
      },
    });
    setOpen(false);
  });

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setCostError(null);
    const form = new FormData(event.currentTarget);

    const cost = formText(form, 'cost');
    if (cost !== '') {
      try {
        parseMoneyInput(cost);
      } catch {
        setCostError('Write the cost as an amount, like 842.00');
        return;
      }
    }
    mutate(form);
  };

  if (!open) {
    return (
      <Button
        variant="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        Add a booking
      </Button>
    );
  }

  return (
    <Card className="p-4 md:p-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <p className="text-base font-semibold">Add a booking</p>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="What is it">
            <Input name="title" required maxLength={200} autoFocus placeholder="Flight to Lisbon" />
          </Field>
          <Field label="Kind">
            <Select name="kind" defaultValue="flight">
              {BOOKING_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABEL[kind]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Who with" hint="The airline, hotel or rental company.">
            <Input name="provider" maxLength={200} placeholder="TAP" />
          </Field>
          <Field label="Confirmation code">
            <Input name="confirmationCode" maxLength={200} placeholder="XK4P2Q" />
          </Field>
          <Field label="From">
            <Input name="origin" maxLength={200} placeholder="EWR" />
          </Field>
          <Field label="To">
            <Input name="destination" maxLength={200} placeholder="LIS" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starts">
              <Input name="startsOn" type="date" />
            </Field>
            <Field label="At">
              <Input name="startsAtTime" type="time" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Ends">
              <Input name="endsOn" type="date" />
            </Field>
            <Field label="At">
              <Input name="endsAtTime" type="time" />
            </Field>
          </div>
          <Field label="Cost">
            <Input name="cost" inputMode="decimal" placeholder="842.00" />
          </Field>
          <Field label="Trip" hint="Leave it unfiled and it waits on the travel page.">
            <Select name="tripId" defaultValue="">
              <option value="">Not filed yet</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <FormError>{costError ?? error}</FormError>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save booking'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setOpen(false);
            }}
          >
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
