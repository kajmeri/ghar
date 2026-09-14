'use client';

import { createTrip } from '@casa/contracts';
import { parseMoneyInput } from '@casa/core/money';
import { useRouter } from 'next/navigation';
import { useId, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { useMutation } from '@/hooks/use-mutation';
import { api, type BodyOf } from '@/lib/api/client';
import { formText } from '@/lib/form';

/**
 * A trip with a name and nothing else is a valid trip, so that is all this asks for.
 * Dates and a budget are here because they are usually known, not because they are needed.
 */
export function NewTripForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const formId = useId();

  const { mutate, pending, error } = useMutation<[BodyOf<typeof createTrip>]>(async (body) => {
    const { trip } = await api.request(createTrip, { body });
    setOpen(false);
    router.push(`/travel/${trip.id}`);
  });

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBudgetError(null);

    const data = new FormData(event.currentTarget);
    const startsOn = formText(data, 'startsOn');
    const budget = formText(data, 'budget');

    let budgetCents: number | null = null;
    if (budget !== '') {
      try {
        budgetCents = parseMoneyInput(budget);
      } catch {
        setBudgetError('Write the budget as an amount, like 2,400 or 2400.00');
        return;
      }
    }

    const body: BodyOf<typeof createTrip> = {
      name: formText(data, 'name'),
      destination: formText(data, 'destination') || null,
      startsOn: startsOn || null,
      // Both dates or neither: a start with no end is a trip that never comes back.
      endsOn: formText(data, 'endsOn') || startsOn || null,
      budgetCents,
      status: startsOn ? 'planned' : 'idea',
    };
    mutate(body);
  };

  if (!open) {
    return (
      <Button
        onClick={() => {
          setOpen(true);
        }}
      >
        Add a trip
      </Button>
    );
  }

  return (
    <Card className="w-full p-4 md:p-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-4" aria-labelledby={formId}>
        <p id={formId} className="text-base font-semibold">
          Add a trip
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Name">
            <Input name="name" required maxLength={200} autoFocus placeholder="Lisbon in March" />
          </Field>
          <Field label="Destination">
            <Input name="destination" maxLength={200} placeholder="Lisbon, Portugal" />
          </Field>
          <Field label="Leaves">
            <Input name="startsOn" type="date" />
          </Field>
          <Field label="Comes back">
            <Input name="endsOn" type="date" />
          </Field>
          <Field label="Budget" hint="Leave it empty if you have not set one.">
            <Input name="budget" inputMode="decimal" placeholder="2,400" />
          </Field>
        </div>

        <FormError>{budgetError ?? error}</FormError>

        <div className="flex gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? 'Saving…' : 'Save trip'}
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
