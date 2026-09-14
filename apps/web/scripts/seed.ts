/**
 * Seeds a demo household so the UI is never built against empty tables, with a five-day trip whose
 * itinerary is half decided. Safe to run again: everything it creates is looked up first.
 *
 *   pnpm --filter web db:seed
 *
 * Reads DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY from apps/web/.env.local or .env.
 * SEED_OWNER_EMAIL and SEED_ADULT_EMAIL override the demo addresses.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HouseholdRole } from '@ghar/core/auth'
import { addCalendarDays, instantInTimeZone, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { invitationExpiresAt, normalizeEmail } from '@ghar/core/invitations'
import type { OptionVote, SlotBand, SlotKind } from '@ghar/core/itinerary'
import { createDb, type Database } from '@ghar/db'
import * as queries from '@ghar/db/queries'
import type { RequestContext, SessionContext } from '@ghar/db/queries'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { z } from 'zod'
import { createInvitationToken } from '@/lib/households/tokens'

const DEMO_HOUSEHOLD = { name: 'Rivera household', timezone: 'America/New_York', currency: 'USD' }
const PEOPLE = {
  owner: { fullName: 'Alex Rivera', defaultEmail: 'owner@ghar-demo.test' },
  adult: { fullName: 'Sam Rivera', defaultEmail: 'adult@ghar-demo.test' },
}
const PENDING_INVITATION = { email: 'grandma@ghar-demo.test', role: 'viewer' } as const

const seedEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  APP_URL: z.url().default('http://localhost:3000'),
  SEED_OWNER_EMAIL: z.email().default(PEOPLE.owner.defaultEmail),
  SEED_ADULT_EMAIL: z.email().default(PEOPLE.adult.defaultEmail),
})

type SeedUser = SessionContext & { email: string }

async function main(): Promise<void> {
  // Existing variables win, and .env.local wins over .env.
  for (const name of ['.env.local', '.env']) {
    const path = fileURLToPath(new URL(`../${name}`, import.meta.url))
    if (existsSync(path)) process.loadEnvFile(path)
  }
  const parsed = seedEnvSchema.safeParse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== '')))
  if (!parsed.success) {
    const names = new Set(parsed.error.issues.map(issue => String(issue.path[0])))
    console.error(`Seed needs these set in apps/web/.env.local: ${[...names].join(', ')}`)
    process.exitCode = 1
    return
  }
  const env = parsed.data

  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const db = createDb(env.DATABASE_URL)
  const run = await queries.startJobRun(db, { jobName: 'seed.demo' })

  try {
    const owner = await findOrCreateUser(supabase, env.SEED_OWNER_EMAIL)
    const adult = await findOrCreateUser(supabase, env.SEED_ADULT_EMAIL)
    await queries.updateProfile(owner, db, { fullName: PEOPLE.owner.fullName })
    await queries.updateProfile(adult, db, { fullName: PEOPLE.adult.fullName })

    const ctx = await ensureHousehold(db, owner)
    await ensureMember(db, ctx, adult, 'adult')
    await ensurePendingInvitation(db, ctx, PENDING_INVITATION.email, PENDING_INVITATION.role)
    const household = await queries.getHousehold(ctx, db)
    const tripId = await ensureDemoTrip(db, ctx, await contextFor(db, adult), household.timezone)

    await queries.finishJobRun(db, run.id, {
      status: 'succeeded',
      metadata: { householdId: household.id },
    })

    console.log(`\nDemo household ready: ${household.name}`)
    console.log(`  Owner   ${owner.email}`)
    console.log(`  Adult   ${adult.email}`)
    console.log(`  Invited ${PENDING_INVITATION.email} (${PENDING_INVITATION.role}, pending)`)
    console.log(`  Trip    ${new URL(`/travel/${tripId}`, env.APP_URL).toString()}`)
    console.log('\nOne-time sign-in links. Each works once, within the hour:')
    console.log(`  Owner   ${await signInLink(supabase, env.APP_URL, owner.email)}`)
    console.log(`  Adult   ${await signInLink(supabase, env.APP_URL, adult.email)}\n`)
  } catch (error) {
    await queries.finishJobRun(db, run.id, { status: 'failed', error })
    throw error
  } finally {
    await db.$client.end()
  }
}

async function findOrCreateUser(supabase: SupabaseClient, address: string): Promise<SeedUser> {
  const email = normalizeEmail(address)
  const perPage = 1000
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage })
    if (error) throw error
    const user = data.users.find(candidate => candidate.email !== undefined && normalizeEmail(candidate.email) === email)
    if (user) return { userId: user.id, email }
    if (data.users.length < perPage) break
  }

  const { data, error } = await supabase.auth.admin.createUser({ email, email_confirm: true })
  if (error) throw error
  return { userId: data.user.id, email }
}

async function ensureHousehold(db: Database, owner: SeedUser): Promise<RequestContext> {
  const existing = await queries.findMembership(owner, db)
  if (existing) return { userId: owner.userId, ...existing }
  const { membership } = await queries.createHousehold(owner, db, DEMO_HOUSEHOLD)
  return { userId: owner.userId, ...membership }
}

/** Adds someone the way the app does: an invitation, then accepting it. */
async function ensureMember(db: Database, ctx: RequestContext, person: SeedUser, role: HouseholdRole): Promise<void> {
  if (await queries.findMembership(person, db)) return
  const { tokenHash } = createInvitationToken()
  const now = new Date()
  await queries.createInvitation(ctx, db, {
    email: person.email,
    role,
    tokenHash,
    expiresAt: invitationExpiresAt(now),
  })
  await queries.acceptInvitation(person, db, { tokenHash, now })
}

async function ensurePendingInvitation(db: Database, ctx: RequestContext, email: string, role: HouseholdRole): Promise<void> {
  const pending = await queries.listPendingInvitations(ctx, db)
  if (pending.some(invitation => invitation.email === normalizeEmail(email))) return
  await queries.createInvitation(ctx, db, {
    email,
    role,
    // Nobody can accept this one: the token is thrown away.
    tokenHash: createInvitationToken().tokenHash,
    expiresAt: invitationExpiresAt(new Date()),
  })
}

async function contextFor(db: Database, person: SeedUser): Promise<RequestContext> {
  const membership = await queries.findMembership(person, db)
  if (!membership) throw new Error(`${person.email} is not in the demo household`)
  return { userId: person.userId, ...membership }
}

const DEMO_TRIP = { name: 'Montréal long weekend', destination: 'Montréal', leadDays: 21, nights: 4, budgetCents: 250_000 }

interface DemoOption extends queries.OptionInput {
  readonly chosen?: boolean
  readonly votes?: { readonly owner?: OptionVote; readonly adult?: OptionVote }
}

interface DemoSlot {
  /** Days after the trip starts. */
  readonly day: number
  readonly band: SlotBand
  readonly kind: SlotKind
  readonly label: string
  /** "HH:MM" where the household is. */
  readonly from?: string
  readonly until?: string
  readonly options: readonly DemoOption[]
}

const HOTEL = { title: 'Hôtel Saint-Paul', address: 'Rue Saint-Paul O, Vieux-Montréal', lat: 45.5046, lng: -73.5549 }
const CAFE = { title: 'Café Olivier', address: 'Rue Saint-Paul O, Vieux-Montréal', lat: 45.502, lng: -73.557, costCents: 1800 }

/**
 * Five days that look like a trip mid-planning: most slots settled, a lunch and a morning still
 * open, one dinner with nothing in it yet, and a dinner between three restaurants that differ on
 * price, distance, hours and whether a table has to be booked by tomorrow.
 */
function demoSlots(today: CalendarDate): DemoSlot[] {
  return [
    {
      day: 0,
      band: 'afternoon',
      kind: 'transport',
      label: 'Train up',
      from: '08:15',
      until: '19:20',
      options: [{ title: 'Adirondack from Penn Station', costCents: 8900, confirmationCode: 'QX7R2M', chosen: true }],
    },
    {
      day: 0,
      band: 'evening',
      kind: 'lodging',
      label: 'Check in',
      from: '19:45',
      options: [{ ...HOTEL, costCents: 81_600, costBasis: 'total', confirmationCode: 'HSP-48213', chosen: true }],
    },
    {
      day: 0,
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      from: '20:30',
      options: [{ title: 'Bistro du Port', address: 'Rue de la Commune E', lat: 45.504, lng: -73.553, costCents: 5500, chosen: true }],
    },
    { day: 1, band: 'morning', kind: 'meal', label: 'Breakfast', from: '08:30', options: [{ ...CAFE, chosen: true }] },
    {
      day: 1,
      band: 'morning',
      kind: 'activity',
      label: 'Morning',
      from: '10:00',
      until: '11:30',
      options: [
        {
          title: 'Notre-Dame Basilica',
          address: 'Place d’Armes',
          lat: 45.5045,
          lng: -73.5561,
          costCents: 1600,
          durationMinutes: 75,
          opensAt: '09:00',
          closesAt: '16:30',
          chosen: true,
        },
      ],
    },
    {
      day: 1,
      band: 'midday',
      kind: 'meal',
      label: 'Lunch',
      from: '12:30',
      options: [
        { title: 'Marché Bonsecours food hall', lat: 45.5088, lng: -73.551, costCents: 1500, votes: { owner: 'yes' } },
        { title: 'Crêperie du Vieux-Port', lat: 45.5075, lng: -73.552, costCents: 2200, votes: { adult: 'yes' } },
      ],
    },
    {
      day: 1,
      band: 'afternoon',
      kind: 'activity',
      label: 'Afternoon',
      from: '14:30',
      until: '17:00',
      options: [{ title: 'Walk up Mount Royal', lat: 45.5048, lng: -73.5877, costCents: 0, durationMinutes: 150, chosen: true }],
    },
    {
      day: 1,
      band: 'evening',
      kind: 'meal',
      label: 'Dinner',
      from: '19:30',
      until: '21:30',
      options: [
        {
          title: 'Maison Ardoise',
          subtitle: 'Market French, Little Burgundy',
          address: 'Rue Notre-Dame O, Little Burgundy',
          lat: 45.4847,
          lng: -73.5815,
          costCents: 9500,
          durationMinutes: 120,
          opensAt: '17:30',
          closesAt: '23:00',
          bookingRequired: true,
          bookingDeadline: addCalendarDays(today, 1),
          tags: ['splurge'],
          votes: { owner: 'yes', adult: 'yes' },
        },
        {
          title: 'Chez Lucien',
          subtitle: 'Bistro, Old Montréal',
          address: 'Rue Saint-François-Xavier',
          lat: 45.5033,
          lng: -73.5569,
          costCents: 6000,
          durationMinutes: 90,
          opensAt: '17:00',
          closesAt: '22:30',
          bookingRequired: true,
          votes: { owner: 'maybe', adult: 'yes' },
        },
        {
          title: 'Deli Saint-Laurent',
          subtitle: 'Smoked meat, the Plateau',
          address: 'Boulevard Saint-Laurent',
          lat: 45.5163,
          lng: -73.5776,
          costCents: 2800,
          durationMinutes: 45,
          opensAt: '08:00',
          closesAt: '19:00',
          votes: { adult: 'no' },
        },
      ],
    },
    {
      day: 2,
      band: 'morning',
      kind: 'activity',
      label: 'Morning',
      from: '09:30',
      options: [
        { title: 'Jean-Talon Market', lat: 45.5362, lng: -73.6147, costCents: 0, durationMinutes: 120, opensAt: '08:00', closesAt: '18:00', votes: { owner: 'yes' } },
        { title: 'Botanical Garden', lat: 45.56, lng: -73.563, costCents: 2500, durationMinutes: 180, opensAt: '09:00', closesAt: '18:00' },
      ],
    },
    {
      day: 2,
      band: 'midday',
      kind: 'meal',
      label: 'Lunch',
      from: '13:00',
      options: [{ title: 'Dépanneur Café', lat: 45.525, lng: -73.595, costCents: 1500, chosen: true }],
    },
    {
      day: 2,
      band: 'night',
      kind: 'activity',
      label: 'Evening',
      from: '21:00',
      options: [
        { title: 'Le Sous-Sol jazz club', lat: 45.499, lng: -73.579, costCents: 3000, bookingRequired: true, confirmationCode: 'JZ-5521', chosen: true },
      ],
    },
    {
      day: 3,
      band: 'morning',
      kind: 'activity',
      label: 'Day trip',
      from: '08:30',
      until: '18:00',
      options: [{ title: 'Mont-Tremblant', costCents: 7500, notes: 'The shuttle leaves from Place Ville Marie.', chosen: true }],
    },
    // Nothing in it yet: the dashed "Add dinner" row.
    { day: 3, band: 'evening', kind: 'meal', label: 'Dinner', from: '19:30', options: [] },
    { day: 4, band: 'morning', kind: 'meal', label: 'Breakfast', from: '07:30', options: [{ ...CAFE, chosen: true }] },
    { day: 4, band: 'morning', kind: 'lodging', label: 'Check out', from: '08:30', options: [{ ...HOTEL, chosen: true }] },
    {
      day: 4,
      band: 'morning',
      kind: 'transport',
      label: 'Train home',
      from: '09:30',
      until: '20:45',
      options: [{ title: 'Adirondack to Penn Station', costCents: 8900, confirmationCode: 'QX7R2N', chosen: true }],
    },
  ]
}

/** Made once, by name. A demo trip someone has since edited is theirs, so it is never rebuilt. */
async function ensureDemoTrip(db: Database, owner: RequestContext, adult: RequestContext, timeZone: string): Promise<string> {
  const today = todayInTimeZone(timeZone)
  const existing = (await queries.listTrips(owner, db, { phase: 'all', today })).find(trip => trip.name === DEMO_TRIP.name)
  if (existing) return existing.id

  const startsOn = addCalendarDays(today, DEMO_TRIP.leadDays)
  const trip = await queries.createTrip(owner, db, {
    name: DEMO_TRIP.name,
    destination: DEMO_TRIP.destination,
    startsOn,
    endsOn: addCalendarDays(startsOn, DEMO_TRIP.nights),
    status: 'planned',
    coverImageUrl: null,
    budgetCents: DEMO_TRIP.budgetCents,
    notes: null,
    memberUserIds: [adult.userId],
  })

  for (const demo of demoSlots(today)) {
    const day = addCalendarDays(startsOn, demo.day)
    const at = (time: string | undefined) => (time === undefined ? null : instantInTimeZone(day, time, timeZone))
    const slot = await queries.createSlot(owner, db, trip.id, {
      day,
      band: demo.band,
      kind: demo.kind,
      label: demo.label,
      startsAt: at(demo.from),
      endsAt: at(demo.until),
      decideBy: null,
      notes: null,
    })

    for (const { chosen = false, votes = {}, ...fields } of demo.options) {
      const updated = await queries.createOption(owner, db, trip.id, slot.id, { ...fields, choose: chosen })
      const option = updated.options.find(candidate => candidate.title === fields.title)
      if (!option) throw new Error(`The option ${fields.title} was not created`)
      if (votes.owner) await queries.voteOnOption(owner, db, trip.id, option.id, { vote: votes.owner })
      if (votes.adult) await queries.voteOnOption(adult, db, trip.id, option.id, { vote: votes.adult })
    }
  }
  return trip.id
}

/** The same link the magic-link email carries, minted without sending anything. */
async function signInLink(supabase: SupabaseClient, appUrl: string, email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email })
  if (error) throw error
  const url = new URL('/auth/callback', appUrl)
  url.searchParams.set('next', '/')
  url.searchParams.set('token_hash', data.properties.hashed_token)
  url.searchParams.set('type', 'email')
  return url.toString()
}

await main()
