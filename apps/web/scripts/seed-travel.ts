import { addCalendarDays, instantInTimeZone, type CalendarDate } from '@ghar/core/dates'
import type { BookingFields } from '@ghar/core/travel'
import type { Database } from '@ghar/db'
import * as queries from '@ghar/db/queries'
import type { RequestContext } from '@ghar/db/queries'

// Travel beyond the Montréal trip: a booked trip with flights, a hotel and a car whose prices are
// being watched, a trip that already happened with its spending, a trip that is only an idea, the
// idea board, packing lists and templates, and bookings the inbox found that nobody has checked yet.
// Each part is written once, and a trip is found by name, so running the seed again adds nothing.

export interface TravelSeedInput {
  owner: RequestContext
  adult: RequestContext
  timeZone: string
  today: CalendarDate
  /** The Montréal trip, which gets a packing list and some spending. */
  montrealTripId: string
}

export async function ensureTravelExtras(db: Database, input: TravelSeedInput): Promise<string[]> {
  return [
    await ensureChicagoTrip(db, input),
    await ensureUnlinkedBooking(db, input),
    await ensurePastTrip(db, input),
    await ensureIdeaTrip(db, input),
    await ensureIdeas(db, input),
    await ensurePacking(db, input),
    await ensureMontrealSpending(db, input),
    await ensureBookingDrafts(db, input),
  ]
}

async function findTrip(db: Database, ctx: RequestContext, today: CalendarDate, name: string): Promise<string | null> {
  const trips = await queries.listTrips(ctx, db, { phase: 'all', today })
  return trips.find(trip => trip.name === name)?.id ?? null
}

const NO_BOOKING: Omit<BookingFields, 'kind' | 'paidCents'> = {
  status: 'booked',
  confirmationCode: null,
  providerName: null,
  carrier: null,
  cabin: null,
  ratePlan: null,
  refundable: false,
  origin: null,
  destination: null,
  propertyName: null,
  checkIn: null,
  checkOut: null,
  departAt: null,
  returnAt: null,
  travelers: 1,
  currency: 'USD',
  watchEnabled: false,
}

// A booked trip, with the price watch at work

const CHICAGO = { name: 'Thanksgiving in Chicago', destination: 'Chicago', leadDays: 68, nights: 5, budgetCents: 320_000 }

async function ensureChicagoTrip(db: Database, { owner, adult, today, timeZone }: TravelSeedInput): Promise<string> {
  if (await findTrip(db, owner, today, CHICAGO.name)) return `Trip ${CHICAGO.name}: already there, left alone`

  const startsOn = addCalendarDays(today, CHICAGO.leadDays)
  const endsOn = addCalendarDays(startsOn, CHICAGO.nights)
  const trip = await queries.createTrip(owner, db, {
    name: CHICAGO.name,
    destination: CHICAGO.destination,
    startsOn,
    endsOn,
    status: 'booked',
    coverImageUrl: null,
    budgetCents: CHICAGO.budgetCents,
    notes: 'Dinner at Aunt Rosa’s on Thursday. Bring the pie dish back.',
    memberUserIds: [adult.userId],
  })

  const flight = await queries.createBooking(owner, db, {
    ...NO_BOOKING,
    kind: 'flight',
    confirmationCode: 'HX4P9T',
    providerName: 'United Airlines',
    carrier: 'UA',
    cabin: 'economy',
    origin: 'LGA',
    destination: 'ORD',
    departAt: instantInTimeZone(startsOn, '07:05', timeZone),
    returnAt: instantInTimeZone(endsOn, '16:40', timeZone),
    travelers: 3,
    paidCents: 104_700,
    watchEnabled: true,
  })
  const hotel = await queries.createBooking(owner, db, {
    ...NO_BOOKING,
    kind: 'hotel',
    confirmationCode: '72215590',
    providerName: 'Hilton',
    ratePlan: 'refundable',
    propertyName: 'Palmer House',
    destination: 'Chicago',
    checkIn: startsOn,
    checkOut: endsOn,
    travelers: 3,
    paidCents: 118_500,
    watchEnabled: true,
  })
  const car = await queries.createBooking(owner, db, {
    ...NO_BOOKING,
    kind: 'car',
    confirmationCode: 'K2281934US',
    providerName: 'Enterprise',
    ratePlan: 'pay_at_property',
    origin: 'O’Hare International Airport',
    destination: 'O’Hare International Airport',
    checkIn: startsOn,
    checkOut: endsOn,
    travelers: 3,
    paidCents: 31_200,
  })
  for (const booking of [flight, hotel, car]) {
    await queries.linkBookingToTrip(owner, db, trip.id, booking.id, { timeZone, addToItinerary: true })
  }

  // Three weeks of daily checks since booking: wobbling around what was paid, one lookup failing,
  // then a real drop in the last few days that earned an alert.
  const flightPrices = [106_200, 107_900, 105_400, 104_700, 108_800, 111_300, 109_500, 106_900, 105_100, null, 103_800, 104_900, 106_600, 107_200, 105_800, 103_300, 101_900, 99_400, 96_100, 94_800, 95_300]
  await recordChecks(db, owner, flight.id, flightPrices, 'exact', 'travelpayouts')
  const floor = flightPrices.at(-2)
  if (typeof floor === 'number') {
    await queries.claimPriceAlert(owner, db, {
      bookingId: flight.id,
      quote: { priceCents: floor, confidence: 'exact', provider: 'travelpayouts' },
      sentAt: new Date(Date.now() - 86_400_000),
    })
  }
  await recordChecks(db, owner, hotel.id, [118_500, 121_000, 119_800, 122_400, 124_000, 123_100, 125_600], 'cached', 'travelpayouts', 3)

  await queries.createManualTransaction(owner, db, { date: addCalendarDays(today, -21), name: 'UNITED 0162438811203', merchantName: 'United Airlines', amountCents: -104_700, tripId: trip.id })
  return `Trip ${CHICAGO.name}: booked, with a watched flight (21 price checks, one failed, one alert), a watched hotel and a car`
}

/** One check a day (or every `everyDays`), the last one yesterday. Null is a failed lookup. */
async function recordChecks(
  db: Database,
  ctx: RequestContext,
  bookingId: string,
  prices: readonly (number | null)[],
  confidence: 'exact' | 'cached',
  provider: string,
  everyDays = 1
): Promise<void> {
  const existing = await queries.listPriceChecks(ctx, db, { bookingIds: [bookingId], since: null })
  if (existing.length > 0) return
  for (const [index, priceCents] of prices.entries()) {
    const daysAgo = (prices.length - index) * everyDays
    const checkedAt = new Date(Date.now() - daysAgo * 86_400_000)
    const outcome =
      priceCents === null
        ? { success: false as const, provider, confidence, error: 'The provider timed out.' }
        : { success: true as const, quote: { priceCents, confidence, provider } }
    await queries.recordPriceCheck(ctx, db, { bookingId, checkedAt, outcome })
  }
}

/** A booking made before its trip exists, which the bookings page shows on its own. */
async function ensureUnlinkedBooking(db: Database, { owner, today }: TravelSeedInput): Promise<string> {
  if ((await queries.listBookings(owner, db)).some(booking => booking.propertyName === 'The Omni Grove Park Inn')) {
    return 'Wedding hotel: already there, left alone'
  }
  const checkIn = addCalendarDays(today, 150)
  await queries.createBooking(owner, db, {
    ...NO_BOOKING,
    kind: 'hotel',
    confirmationCode: 'GPI-30918',
    providerName: 'Omni Hotels',
    ratePlan: 'prepaid',
    propertyName: 'The Omni Grove Park Inn',
    destination: 'Asheville',
    checkIn,
    checkOut: addCalendarDays(checkIn, 2),
    travelers: 2,
    paidCents: 86_400,
  })
  return 'Wedding hotel: a booking with no trip yet'
}

// A trip that already happened

const CAPE_COD = { name: 'Cape Cod week', destination: 'Wellfleet, MA', daysAgo: 68, nights: 7, budgetCents: 380_000 }

const CAPE_COD_SPENDING: [daysIn: number, name: string, merchant: string | null, cents: number][] = [
  [-60, 'AIRBNB * HMQ2X8TR', 'Airbnb', -214_000],
  [0, 'SHELL OIL 57442', 'Shell', -6_840],
  [0, 'STOP & SHOP 0412', 'Stop & Shop', -18_730],
  [1, 'MAC’S SHACK', 'Mac’s Shack', -14_200],
  [2, 'NATIONAL SEASHORE PASS', 'National Park Service', -4_500],
  [3, 'DOLPHIN FLEET WHALE WATCH', 'Dolphin Fleet', -21_600],
  [3, 'PJ’S FAMILY RESTAURANT', 'PJ’s', -7_820],
  [4, 'Cash, ice cream and parking', null, -6_000],
  [5, 'WELLFLEET OYSTER CO', 'Wellfleet Oyster Co', -11_350],
  [6, 'MARCONI BEACH PARKING', null, -2_500],
  [7, 'SHELL OIL 57442', 'Shell', -6_120],
  [9, 'AIRBNB SECURITY DEPOSIT REFUND', 'Airbnb', 25_000],
]

async function ensurePastTrip(db: Database, { owner, adult, today }: TravelSeedInput): Promise<string> {
  if (await findTrip(db, owner, today, CAPE_COD.name)) return `Trip ${CAPE_COD.name}: already there, left alone`

  const startsOn = addCalendarDays(today, -CAPE_COD.daysAgo)
  const trip = await queries.createTrip(owner, db, {
    name: CAPE_COD.name,
    destination: CAPE_COD.destination,
    startsOn,
    endsOn: addCalendarDays(startsOn, CAPE_COD.nights),
    status: 'past',
    coverImageUrl: null,
    budgetCents: CAPE_COD.budgetCents,
    notes: 'The house on Old King’s Highway. Book again for next July before February.',
    memberUserIds: [adult.userId],
  })
  for (const [daysIn, name, merchantName, amountCents] of CAPE_COD_SPENDING) {
    await queries.createManualTransaction(owner, db, { date: addCalendarDays(startsOn, daysIn), name, merchantName, amountCents, tripId: trip.id })
  }
  for (const label of ['Beach tent', 'Boogie boards', 'Sunscreen', 'Bug spray', 'Rain jackets', 'Card games', 'Cooler']) {
    const item = await queries.createPackingItem(owner, db, trip.id, { label, assignedUserId: null, category: 'Beach' })
    await queries.updatePackingItem(owner, db, trip.id, item.id, { isPacked: true })
  }
  return `Trip ${CAPE_COD.name}: in the past, ${String(CAPE_COD_SPENDING.length)} charges against its budget and a packed list`
}

// A trip that is only an idea

const LISBON = { name: 'Lisbon and Porto', destination: 'Portugal' }

async function ensureIdeaTrip(db: Database, { owner, today }: TravelSeedInput): Promise<string> {
  if (await findTrip(db, owner, today, LISBON.name)) return `Trip ${LISBON.name}: already there, left alone`
  const startsOn = addCalendarDays(today, 220)
  await queries.createTrip(owner, db, {
    name: LISBON.name,
    destination: LISBON.destination,
    startsOn,
    endsOn: addCalendarDays(startsOn, 9),
    status: 'idea',
    coverImageUrl: null,
    budgetCents: null,
    notes: 'Spring break? Check whether the train between the two is worth it over driving.',
    memberUserIds: [],
  })
  return `Trip ${LISBON.name}: still an idea`
}

const IDEAS = [
  { title: 'Banff and Lake Louise', destination: 'Alberta, Canada', url: 'https://www.banfflakelouise.com/', notes: 'Late June, before the crowds. Canoe on Moraine Lake early.' },
  { title: 'Kyoto in cherry blossom season', destination: 'Kyoto, Japan', url: null, notes: 'Early April. Ryokan for at least two nights.' },
  { title: 'Outer Banks beach house', destination: 'Duck, NC', url: null, notes: 'Split a big house with the Parks?' },
  { title: 'Vermont fall foliage weekend', destination: 'Stowe, VT', url: null, notes: 'Peak is usually the first two weeks of October.' },
  { title: 'Mexico City food trip', destination: 'Mexico City', url: null, notes: null },
]

async function ensureIdeas(db: Database, { owner, adult }: TravelSeedInput): Promise<string> {
  if ((await queries.listTripIdeas(owner, db)).length > 0) return 'Idea board: already there, left alone'
  for (const [index, idea] of IDEAS.entries()) {
    // Both of them add ideas.
    await queries.createTripIdea(index % 2 === 0 ? owner : adult, db, { ...idea, imageUrl: null })
  }
  return `Idea board: ${String(IDEAS.length)} ideas`
}

// Packing

const TEMPLATES: { name: string; items: [label: string, category: string][] }[] = [
  {
    name: 'Weekend away',
    items: [
      ['Phone chargers', 'Tech'],
      ['Toothbrushes', 'Toiletries'],
      ['Toiletry bag', 'Toiletries'],
      ['Pajamas', 'Clothes'],
      ['Two changes of clothes', 'Clothes'],
      ['Walking shoes', 'Clothes'],
      ['Snacks for the car', 'Kids'],
      ['Tablet and headphones', 'Kids'],
    ],
  },
  {
    name: 'International',
    items: [
      ['Passports', 'Documents'],
      ['Travel insurance card', 'Documents'],
      ['Power adapters', 'Tech'],
      ['Some local cash', 'Money'],
      ['Card with no foreign fees', 'Money'],
      ['Medications, in original bottles', 'Toiletries'],
    ],
  },
]

async function ensurePacking(db: Database, { owner, adult, montrealTripId }: TravelSeedInput): Promise<string> {
  const templates = await queries.listPackingTemplates(owner, db)
  const ids = new Map(templates.map(template => [template.name, template.id]))
  if (templates.length === 0) {
    for (const template of TEMPLATES) {
      const created = await queries.createPackingTemplate(owner, db, {
        name: template.name,
        items: template.items.map(([label, category]) => ({ label, category })),
      })
      ids.set(template.name, created.id)
    }
  }

  if ((await queries.listPackingItems(owner, db, montrealTripId)).length > 0) return 'Packing: Montréal already has a list, left alone'
  for (const name of ['Weekend away', 'International']) {
    const templateId = ids.get(name)
    if (templateId !== undefined) await queries.applyPackingTemplate(owner, db, montrealTripId, templateId)
  }
  const extras: [label: string, category: string, who: 'owner' | 'adult' | null][] = [
    ['Warm layers for Mont-Tremblant', 'Clothes', 'adult'],
    ['Train tickets on the phone', 'Documents', 'owner'],
    ['Jazz club reservation', 'Documents', 'owner'],
  ]
  for (const [label, category, who] of extras) {
    await queries.createPackingItem(owner, db, montrealTripId, {
      label,
      category,
      assignedUserId: who === 'owner' ? owner.userId : who === 'adult' ? adult.userId : null,
    })
  }
  // A third of the way packed.
  const items = await queries.listPackingItems(owner, db, montrealTripId)
  for (const item of items.filter((_, index) => index % 3 === 0)) {
    await queries.updatePackingItem(owner, db, montrealTripId, item.id, { isPacked: true })
  }
  return `Packing: ${String(TEMPLATES.length)} templates, and Montréal’s list a third packed`
}

async function ensureMontrealSpending(db: Database, { owner, today, montrealTripId }: TravelSeedInput): Promise<string> {
  if ((await queries.sumTripActualCents(owner, db, montrealTripId)) !== 0) return 'Montréal spending: already there, left alone'
  const charges: [daysAgo: number, name: string, merchant: string, cents: number][] = [
    [18, 'AMTRAK 0460912285', 'Amtrak', -17_800],
    [15, 'HOTEL ST-PAUL MONTREAL DEPOSIT', 'Hôtel Saint-Paul', -20_400],
    [6, 'LE SOUS-SOL JAZZ', 'Le Sous-Sol', -6_000],
  ]
  for (const [daysAgo, name, merchantName, amountCents] of charges) {
    await queries.createManualTransaction(owner, db, { date: addCalendarDays(today, -daysAgo), name, merchantName, amountCents, tripId: montrealTripId })
  }
  return `Montréal spending: ${String(charges.length)} charges so far`
}

// Bookings the inbox found

async function ensureBookingDrafts(db: Database, { owner, today }: TravelSeedInput): Promise<string> {
  const depart = addCalendarDays(today, 96)
  const drafts = [
    {
      messageId: 'seed-draft-jetblue',
      receivedAt: new Date(Date.now() - 2 * 3_600_000),
      senderDomain: 'jetblue.com',
      subject: 'Your JetBlue itinerary: BOS to FLL',
      rawExtract: {
        isBooking: true,
        kind: 'flight',
        status: 'booked',
        confirmationCode: 'QWERTZ',
        providerName: 'JetBlue',
        carrier: 'B6',
        cabin: 'economy',
        ratePlan: null,
        refundable: false,
        origin: 'BOS',
        destination: 'FLL',
        propertyName: null,
        checkIn: null,
        checkOut: null,
        departAt: `${depart}T09:40`,
        returnAt: `${addCalendarDays(depart, 5)}T18:15`,
        travelers: 2,
        totalPaid: '612.40',
        currency: 'USD',
      },
    },
    {
      // What the model couldn't read is left null, so saving it asks for the dates.
      messageId: 'seed-draft-hertz',
      receivedAt: new Date(Date.now() - 26 * 3_600_000),
      senderDomain: 'hertz.com',
      subject: 'Hertz reservation confirmed',
      rawExtract: {
        isBooking: true,
        kind: 'car',
        status: 'booked',
        confirmationCode: 'H0847712',
        providerName: 'Hertz',
        carrier: null,
        cabin: null,
        ratePlan: 'pay_at_property',
        refundable: null,
        origin: 'Fort Lauderdale Airport',
        destination: null,
        propertyName: null,
        checkIn: null,
        checkOut: null,
        departAt: null,
        returnAt: null,
        travelers: null,
        totalPaid: null,
        currency: null,
      },
    },
  ]
  let created = 0
  for (const draft of drafts) {
    if (await queries.createBookingDraft(owner, db, { userId: owner.userId, ...draft })) created += 1
  }
  return created === 0 ? 'Inbox drafts: already there, left alone' : `Inbox drafts: ${String(created)} bookings found in email, waiting for review`
}
