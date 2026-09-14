/**
 * Seeds a demo household so the UI is never built against empty tables. Safe to run again:
 * everything it creates is looked up first.
 *
 *   pnpm --filter web db:seed
 *
 * Reads DATABASE_URL, SUPABASE_URL and SUPABASE_SECRET_KEY from apps/web/.env.local or .env.
 * SEED_OWNER_EMAIL and SEED_ADULT_EMAIL override the demo addresses.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { HouseholdRole } from '@ghar/core/auth'
import { invitationExpiresAt, normalizeEmail } from '@ghar/core/invitations'
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

    await queries.finishJobRun(db, run.id, {
      status: 'succeeded',
      metadata: { householdId: household.id },
    })

    console.log(`\nDemo household ready: ${household.name}`)
    console.log(`  Owner   ${owner.email}`)
    console.log(`  Adult   ${adult.email}`)
    console.log(`  Invited ${PENDING_INVITATION.email} (${PENDING_INVITATION.role}, pending)`)
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
