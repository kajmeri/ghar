import { can } from '@ghar/core/auth';
import {
  agendaDays,
  formatMonth,
  isMonthKey,
  monthGridWeeks,
  monthOf,
  monthRange,
  parseFeedSources,
} from '@ghar/core/calendar';
import { todayInTimeZone } from '@ghar/core/dates';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { getPageContext } from '@/lib/auth/context';
import { CONNECT_HREF, CONNECT_MESSAGES, isConnectStatus } from '@/lib/calendar/display';
import * as calendar from '@/lib/calendar/service';
import { EmptyState } from '../_components/ui/empty-state';
import { CalendarIllustration } from '../_components/ui/illustrations';
import { PageHeader } from '../_components/ui/page-header';
import { Agenda } from './_components/agenda';
import { LinkedCalendars } from './_components/linked-calendars';
import { MonthGrid } from './_components/month-grid';
import { MonthNav } from './_components/month-nav';
import { MonthStrip } from './_components/month-strip';
import { Notice } from './_components/notice';
import { SourceFilter } from './_components/source-filter';

export const metadata: Metadata = { title: 'Calendar' };

export default async function CalendarPage({ searchParams }: PageProps<'/calendar'>) {
  const params = await searchParams;
  const { ctx } = await getPageContext();
  const canManage = can(ctx.role, 'calendar.manage');

  const [{ timezone }, links] = await Promise.all([
    calendar.getCalendarSettings(ctx),
    calendar.listCalendarLinks(ctx),
  ]);
  const today = todayInTimeZone(timezone);
  const currentMonth = monthOf(today);
  const month =
    typeof params.month === 'string' && isMonthKey(params.month) ? params.month : currentMonth;
  const monthParam = month === currentMonth ? null : month;

  const available = calendar.availableFeedSources(ctx, links);
  const requested = parseFeedSources(params.sources).filter((source) =>
    available.includes(source),
  );
  const sources = requested.length > 0 ? requested : available;
  const filtered = sources.length < available.length;

  // The feed covers the grid's whole weeks, so the days before the 1st and after the last aren't blank.
  const weeks = monthGridWeeks(month);
  const range = monthRange(month);
  const feed = await calendar.getCalendarFeed(ctx, {
    from: weeks[0]?.[0] ?? range.from,
    to: weeks.at(-1)?.at(-1) ?? range.to,
    sources,
  });
  const days = agendaDays(feed.items, range);

  const status = isConnectStatus(params.calendar) ? CONNECT_MESSAGES[params.calendar] : null;
  const needsReconnect = links.filter((link) => link.mine && link.status === 'needs_reconnect');
  const newEventHref = `/calendar/events/new?date=${month === currentMonth ? today : range.from}`;

  return (
    <>
      <PageHeader
        title="Calendar"
        description="Everyone’s plans in one place"
        action={
          canManage ? (
            <Button asChild>
              <Link href={newEventHref}>
                <Plus aria-hidden />
                New event
              </Link>
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-6">
        {status ? (
          <Notice tone={status.tone} role="status">
            {status.text}
          </Notice>
        ) : null}
        {needsReconnect.map((link) => (
          <Notice
            key={link.id}
            tone="caution"
            action={
              <Button asChild>
                <a href={CONNECT_HREF}>Reconnect</a>
              </Button>
            }
          >
            Google Calendar for {link.accountEmail} needs reconnecting. Its events here stop
            updating until you do.
          </Notice>
        ))}

        <div className="flex flex-col gap-3">
          <MonthNav
            month={month}
            currentMonth={currentMonth}
            sources={sources}
            available={available}
          />
          <SourceFilter month={monthParam} sources={sources} available={available} />
        </div>

        <div className="hidden lg:block">
          {feed.items.length === 0 ? (
            <p className="pb-3 text-ink-muted">
              Nothing planned in {formatMonth(month)}
              {filtered ? ' from the calendars shown' : ''}.
            </p>
          ) : null}
          <MonthGrid
            month={month}
            weeks={weeks}
            items={feed.items}
            today={today}
            timeZone={timezone}
          />
        </div>

        <div className="flex flex-col gap-4 lg:hidden">
          <MonthStrip
            key={month}
            month={month}
            weeks={weeks}
            today={today}
            busyDates={days.map((day) => day.date)}
          />
          {days.length > 0 ? (
            <Agenda days={days} today={today} timeZone={timezone} />
          ) : (
            <EmptyState
              level={3}
              illustration={<CalendarIllustration />}
              title={`Nothing planned in ${formatMonth(month)}`}
              description={
                filtered
                  ? 'Some calendars are hidden. Turn them back on above to see their events.'
                  : canManage
                    ? 'Add an event, or link Google Calendar below to bring in your own plans.'
                    : 'Events the adults in your household add show up here.'
              }
              action={
                canManage && !filtered ? (
                  <Button asChild>
                    <Link href={newEventHref}>
                      <Plus aria-hidden />
                      New event
                    </Link>
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>

        <LinkedCalendars
          links={links}
          timeZone={timezone}
          canManage={canManage}
          canManageOthers={can(ctx.role, 'connections.manage')}
        />
      </div>
    </>
  );
}
