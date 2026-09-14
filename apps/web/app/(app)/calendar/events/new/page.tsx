import { can } from '@ghar/core/auth';
import { monthOf } from '@ghar/core/calendar';
import { isCalendarDate, todayInTimeZone } from '@ghar/core/dates';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPageContext } from '@/lib/auth/context';
import { newEventDefaults } from '@/lib/calendar/form-defaults';
import * as calendar from '@/lib/calendar/service';
import * as households from '@/lib/households/service';
import { PageHeader } from '../../../_components/ui/page-header';
import { BackLink } from '../../_components/back-link';
import { EventForm } from '../../_components/event-form';

export const metadata: Metadata = { title: 'New event' };

export default async function NewEventPage({ searchParams }: PageProps<'/calendar/events/new'>) {
  const { date } = await searchParams;
  const { ctx } = await getPageContext();
  if (!can(ctx.role, 'calendar.manage')) redirect('/calendar');

  const [{ timezone }, members] = await Promise.all([
    calendar.getCalendarSettings(ctx),
    can(ctx.role, 'members.view') ? households.listMembers(ctx) : Promise.resolve([]),
  ]);
  const day = typeof date === 'string' && isCalendarDate(date) ? date : todayInTimeZone(timezone);
  const backHref = `/calendar?month=${monthOf(day)}`;

  return (
    <>
      <BackLink href={backHref}>Calendar</BackLink>
      <PageHeader title="New event" />
      <EventForm
        event={newEventDefaults(day)}
        members={members}
        timeZone={timezone}
        cancelHref={backHref}
      />
    </>
  );
}
