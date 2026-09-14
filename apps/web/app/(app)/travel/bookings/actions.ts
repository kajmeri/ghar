'use server'

import { bookingParamsSchema } from '@ghar/contracts'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { parseForm, runAction } from '@/lib/actions/run'
import type { ActionState } from '@/lib/actions/state'
import { getRequestContext } from '@/lib/auth/context'
import { bookingFieldsFromForm, bookingFormSchema } from '@/lib/travel/form'
import type { PriceWatchResult } from '@/lib/travel/price-watch'
import * as travel from '@/lib/travel/service'
import { simulatePriceCheck } from '@/lib/travel/simulate'

// Form wrappers around the same service the /api/v1/travel routes call. Permissions are checked in
// the queries, so these parse, call, and refresh the pages.

const BOOKINGS_PATH = '/travel/bookings'

const updateFormSchema = bookingFormSchema.extend({ bookingId: z.uuid() })

const watchFormSchema = bookingParamsSchema.extend({
  watchEnabled: z.enum(['true', 'false']).transform(value => value === 'true'),
})

const optionalCents = z.preprocess(
  value => (value === '' ? undefined : value),
  z.coerce.number().int('Enter an amount like 420.00').nonnegative('Enter an amount of zero or more').nullable().default(null)
)
const checkbox = z.preprocess(value => value === 'on', z.boolean())

const simulateFormSchema = bookingParamsSchema.extend({
  priceCents: optionalCents,
  exactCents: optionalCents,
  failCached: checkbox,
  failExact: checkbox,
})

export async function createBookingAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const values = parseForm(bookingFormSchema, formData)
    const { timezone } = await travel.getTravelSettings(ctx)
    const booking = await travel.createBooking(ctx, bookingFieldsFromForm(values, timezone))
    revalidatePath(BOOKINGS_PATH)
    return redirect(`${BOOKINGS_PATH}/${booking.id}`)
  })
}

export async function updateBookingAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { bookingId, ...values } = parseForm(updateFormSchema, formData)
    const { timezone } = await travel.getTravelSettings(ctx)
    await travel.updateBooking(ctx, { ...bookingFieldsFromForm(values, timezone), bookingId })
    revalidatePath(BOOKINGS_PATH, 'layout')
    return redirect(`${BOOKINGS_PATH}/${bookingId}`)
  })
}

export async function setWatchAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const booking = await travel.setBookingWatch(ctx, parseForm(watchFormSchema, formData))
    revalidatePath(BOOKINGS_PATH, 'layout')
    return booking.watchEnabled
      ? 'Watching. The price is checked every morning.'
      : 'Watch off. The price isn’t checked until you turn it back on.'
  })
}

export async function deleteBookingAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    await travel.deleteBooking(ctx, parseForm(bookingParamsSchema, formData))
    revalidatePath(BOOKINGS_PATH, 'layout')
    return redirect(BOOKINGS_PATH)
  })
}

/** Development only. The price sets both tiers unless a separate verified price is given. */
export async function simulatePriceAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return runAction(formData, async () => {
    const ctx = await getRequestContext()
    const { bookingId, priceCents, exactCents, failCached, failExact } = parseForm(simulateFormSchema, formData)
    const result = await simulatePriceCheck(ctx, {
      bookingId,
      cachedCents: priceCents,
      exactCents: exactCents ?? priceCents,
      failCached,
      failExact,
    })
    revalidatePath(BOOKINGS_PATH, 'layout')
    return simulationMessage(result)
  })
}

function simulationMessage(result: PriceWatchResult): string {
  const plural = (count: number, word: string) => `${String(count)} ${word}${count === 1 ? '' : 's'}`
  const parts = [`Checked ${plural(result.checked, 'booking')}.`]
  if (result.verified > 0) parts.push(`Verified ${plural(result.verified, 'drop')}.`)
  if (result.lookupsFailed > 0) parts.push(`${plural(result.lookupsFailed, 'lookup')} failed.`)
  parts.push(
    result.alerted === 0
      ? 'No email sent.'
      : `Sent ${plural(result.alerted, 'email')}. Without RESEND_API_KEY it’s printed in the dev server console instead.`
  )
  if (result.errors > 0) parts.push(`${plural(result.errors, 'booking')} hit an error; see the dev server console.`)
  return parts.join(' ')
}
