'use server';

import {
  attendeeResponseSchema,
  calendarLinkParamsSchema,
  eventParamsSchema,
  type CalendarSyncResult,
} from '@ghar/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { parseForm, runAction } from '@/lib/actions/run';
import type { ActionState } from '@/lib/actions/state';
import { getRequestContext } from '@/lib/auth/context';
import { eventInputFromForm } from '@/lib/calendar/form';
import * as calendar from '@/lib/calendar/service';

// Form wrappers around the same service the /api/v1/calendar routes call. Permissions are checked
// in the queries, so these parse, call, and refresh the pages.

const CALENDAR_PATH = '/calendar';

const responseFormSchema = eventParamsSchema.extend({ response: attendeeResponseSchema });

export async function createEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext();
    const { timezone } = await calendar.getCalendarSettings(ctx);
    const event = await calendar.createEvent(ctx, eventInputFromForm(formData, timezone));
    revalidatePath(CALENDAR_PATH, 'layout');
    return redirect(`${CALENDAR_PATH}/events/${event.id}`);
  });
}

export async function updateEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext();
    const { eventId } = parseForm(eventParamsSchema, formData);
    const { timezone } = await calendar.getCalendarSettings(ctx);
    await calendar.updateEvent(ctx, { ...eventInputFromForm(formData, timezone), eventId });
    revalidatePath(CALENDAR_PATH, 'layout');
    return redirect(`${CALENDAR_PATH}/events/${eventId}`);
  });
}

export async function deleteEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext();
    await calendar.deleteEvent(ctx, parseForm(eventParamsSchema, formData));
    revalidatePath(CALENDAR_PATH, 'layout');
    return redirect(CALENDAR_PATH);
  });
}

export async function respondToEventAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext();
    await calendar.respondToEvent(ctx, parseForm(responseFormSchema, formData));
    revalidatePath(CALENDAR_PATH, 'layout');
    return undefined;
  });
}

export async function syncNowAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const results = await calendar.syncHouseholdCalendars(await getRequestContext());
    revalidatePath(CALENDAR_PATH, 'layout');
    return syncMessage(results);
  });
}

export async function disconnectCalendarAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext();
    await calendar.disconnectCalendarLink(ctx, parseForm(calendarLinkParamsSchema, formData));
    revalidatePath(CALENDAR_PATH, 'layout');
    return 'Calendar disconnected. Its events are off the calendar.';
  });
}

function syncMessage(results: CalendarSyncResult[]): string {
  if (results.length === 0) return 'Nothing to sync. Reconnect a calendar or link one first.';
  const count = (outcome: CalendarSyncResult['outcome']) =>
    results.filter((result) => result.outcome === outcome).length;
  const calendars = (n: number) => `${String(n)} calendar${n === 1 ? '' : 's'}`;

  const parts: string[] = [];
  const synced = count('synced');
  if (synced > 0) {
    const changes = results.reduce((sum, result) => sum + result.upserted + result.removed, 0);
    parts.push(
      changes === 0
        ? `Synced ${calendars(synced)}. Nothing changed.`
        : `Synced ${calendars(synced)}: ${String(changes)} change${changes === 1 ? '' : 's'}.`,
    );
  }
  const reconnect = count('needs_reconnect');
  if (reconnect > 0) {
    parts.push(`${calendars(reconnect)} need${reconnect === 1 ? 's' : ''} reconnecting.`);
  }
  const failed = count('error');
  if (failed > 0) {
    parts.push(`${calendars(failed)} didn’t sync. Try again in a minute.`);
  }
  return parts.length > 0 ? parts.join(' ') : 'Nothing to sync right now.';
}
