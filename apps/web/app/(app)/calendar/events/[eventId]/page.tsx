import { eventParamsSchema } from '@ghar/contracts';
import { can } from '@ghar/core/auth';
import { allDayDate, monthOf } from '@ghar/core/calendar';
import { toCalendarDate } from '@ghar/core/dates';
import { NotFoundError } from '@ghar/core/errors';
import { Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { getPageContext } from '@/lib/auth/context';
import {
  CATEGORY_LABELS,
  COLOR_LABELS,
  eventWhen,
  memberName,
  RESPONSE_LABELS,
  TONE_DOT,
} from '@/lib/calendar/display';
import * as calendar from '@/lib/calendar/service';
import * as households from '@/lib/households/service';
import { cn } from '@/lib/utils';
import { PageHeader } from '../../../_components/ui/page-header';
import { SectionHeader } from '../../../_components/ui/section-header';
import { BackLink } from '../../_components/back-link';
import { DeleteEvent } from '../../_components/delete-event';
import { ResponseControl } from '../../_components/response-control';

export const metadata: Metadata = { title: 'Event' };

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6';

export default async function EventPage({
  params,
  searchParams,
}: PageProps<'/calendar/events/[eventId]'>) {
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  if (!eventParamsSchema.safeParse({ eventId }).success) notFound();
  const { ctx } = await getPageContext();

  const [event, { timezone }, members] = await Promise.all([
    calendar.getEvent(ctx, { eventId }).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }),
    calendar.getCalendarSettings(ctx),
    can(ctx.role, 'members.view') ? households.listMembers(ctx) : Promise.resolve([]),
  ]);

  // Which repeat was opened, when it came from the calendar. Only meaningful for a series.
  const occurrence =
    event.rrule !== null &&
    typeof query.occurrence === 'string' &&
    z.iso.datetime().safeParse(query.occurrence).success
      ? query.occurrence
      : null;
  const start = new Date(occurrence ?? event.startsAt);
  const month = monthOf(event.allDay ? allDayDate(start) : toCalendarDate(start, timezone));
  const when = eventWhen(event, timezone, occurrence);
  const byId = new Map(members.map((member) => [member.userId, member]));
  const mine = event.attendees.find((attendee) => attendee.userId === ctx.userId);

  return (
    <>
      <BackLink href={`/calendar?month=${month}`}>Calendar</BackLink>
      <PageHeader
        title={event.title}
        description={when}
        action={
          event.editable ? (
            <Button asChild variant="outline">
              <Link href={`/calendar/events/${event.id}/edit`}>
                <Pencil aria-hidden />
                Edit event
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-10">
        {event.externalSource ? (
          <p className={`${CARD} text-ink-muted`}>
            Synced from Google Calendar. Change it there, and the next sync brings the change here.
          </p>
        ) : null}

        <section aria-labelledby="details-heading">
          <SectionHeader id="details-heading" title="Details" />
          <dl className="divide-y divide-line rounded-card border border-line bg-surface">
            <Row label="When">{when}</Row>
            {event.rrule !== null ? (
              <Row label="Repeats">
                {event.recurrence ?? 'On a custom schedule'}
                {event.editable ? (
                  <span className="block text-sm text-ink-muted">
                    Changes apply every time it repeats.
                  </span>
                ) : null}
              </Row>
            ) : null}
            {event.location ? <Row label="Where">{event.location}</Row> : null}
            {event.externalSource ? (
              <Row label="Calendar">Google</Row>
            ) : (
              <Row label="Category">{CATEGORY_LABELS[event.category]}</Row>
            )}
            {event.colorToken ? (
              <Row label="Marked">
                <span className="inline-flex items-center gap-2">
                  <span
                    aria-hidden
                    className={cn('size-2.5 rounded-pill', TONE_DOT[event.colorToken])}
                  />
                  {COLOR_LABELS[event.colorToken]}
                </span>
              </Row>
            ) : null}
            {event.description ? (
              <Row label="Notes">
                <span className="whitespace-pre-line">{event.description}</span>
              </Row>
            ) : null}
          </dl>
        </section>

        {event.externalSource ? null : (
          <section aria-labelledby="people-heading">
            <SectionHeader id="people-heading" title="Who’s going" />
            <div className="flex flex-col gap-3">
              {mine ? (
                <div className={CARD}>
                  <ResponseControl eventId={event.id} response={mine.response} />
                </div>
              ) : null}
              {event.attendees.length === 0 ? (
                <p className={`${CARD} text-ink-muted`}>
                  {event.editable
                    ? 'No one added yet. Edit the event to add people from your household.'
                    : 'No one added yet.'}
                </p>
              ) : (
                <ul className="divide-y divide-line rounded-card border border-line bg-surface">
                  {event.attendees.map((attendee) => (
                    <li
                      key={attendee.userId}
                      className="flex items-start justify-between gap-4 px-4 py-3"
                    >
                      <span className="min-w-0 break-words">
                        {memberName(byId.get(attendee.userId))}
                        {attendee.userId === ctx.userId ? (
                          <span className="text-ink-muted"> · You</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-right text-ink-muted">
                        {RESPONSE_LABELS[attendee.response]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {event.editable ? (
          <div className="border-t border-line pt-6">
            <DeleteEvent eventId={event.id} title={event.title} recurring={event.rrule !== null} />
          </div>
        ) : null}
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 md:flex-row md:gap-6">
      <dt className="shrink-0 text-sm text-ink-muted md:w-28 md:text-base">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}
