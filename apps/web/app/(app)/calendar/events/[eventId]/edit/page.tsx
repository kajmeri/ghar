import { eventParamsSchema } from '@ghar/contracts';
import { can } from '@ghar/core/auth';
import { NotFoundError } from '@ghar/core/errors';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getPageContext } from '@/lib/auth/context';
import { eventFormDefaults } from '@/lib/calendar/form-defaults';
import * as calendar from '@/lib/calendar/service';
import * as households from '@/lib/households/service';
import { PageHeader } from '../../../../_components/ui/page-header';
import { BackLink } from '../../../_components/back-link';
import { EventForm } from '../../../_components/event-form';

export const metadata: Metadata = { title: 'Edit event' };

export default async function EditEventPage({
  params,
}: PageProps<'/calendar/events/[eventId]/edit'>) {
  const { eventId } = await params;
  if (!eventParamsSchema.safeParse({ eventId }).success) notFound();
  const { ctx } = await getPageContext();
  const eventHref = `/calendar/events/${eventId}`;
  if (!can(ctx.role, 'calendar.manage')) redirect(eventHref);

  const [event, { timezone }, members] = await Promise.all([
    calendar.getEvent(ctx, { eventId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    calendar.getCalendarSettings(ctx),
    can(ctx.role, 'members.view') ? households.listMembers(ctx) : Promise.resolve([]),
  ]);
  // Synced events change only in their own calendar.
  if (!event.editable) redirect(eventHref);

  return (
    <>
      <BackLink href={eventHref}>{event.title}</BackLink>
      <PageHeader
        title="Edit event"
        description={event.rrule === null ? undefined : 'Changes apply every time it repeats.'}
      />
      <EventForm
        event={eventFormDefaults(event, timezone)}
        members={members}
        timeZone={timezone}
        cancelHref={eventHref}
      />
    </>
  );
}
