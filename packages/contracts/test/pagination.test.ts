import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as contracts from '../src'
import type { EndpointDefinition } from '../src/endpoint'
import { pageQuerySchema, pageSchema } from '../src/v1/shared'

// Every v1 GET that returns a list of like resources pages with a cursor: `cursor` and `limit` in,
// `items` and `nextCursor` out. The exemptions are in shared.ts, and repeated here so a new list
// that returns a bare array fails until it pages or says why it doesn't.

const PAGED = [
  'listAccounts',
  'listAssets',
  'listBills',
  'listBookings',
  'listCalendarLinks',
  'listCategories',
  'listContacts',
  'listDocuments',
  'listExpiries',
  'listInvitations',
  'listMailBookingDrafts',
  'listMaintenance',
  'listManualAccounts',
  'listManualValues',
  'listMembers',
  'listNetWorthHistory',
  'listPacking',
  'listPackingTemplates',
  'listTransactions',
  'listTripIdeas',
  'listTrips',
] as const

/** GETs whose response holds a top-level array but isn't a list endpoint, and why. */
const EXEMPT: Record<string, string> = {
  getCalendarFeed: 'a range of days, at most MAX_FEED_DAYS, checked by its query schema',
  getAttention: 'what needs someone now, over fixed windows',
  getTravelHub: 'one view of current trips, unlinked bookings and ideas, each also a paged list',
  getItinerary: 'one trip’s own tree',
  getDecisions: 'one trip’s own tree',
  getTravelMode: 'one trip’s own tree',
  getTripBudget: 'one trip’s own tree',
  getTrip: 'one trip’s own tree',
  getBill: 'its due dates are children of the bill',
  getContact: 'its jobs are children of the contact',
  getAsset: 'its jobs, documents and history are children of the asset',
  getMaintenanceTask: 'its history is a child of the job',
  getBooking: 'its price history, checks and alerts are children of the booking',
  getHouseholdOptions: 'the runtime’s fixed time zone and currency lists, not household data',
  getDigestPreferences: 'a single record; availableSections is a fixed list',
  getNetWorthComposition: 'one summary of the investment accounts, capped by the Plaid Item limit',
  listDebts: 'the liability accounts, capped by the Plaid Item limit and sorted by APR as a whole',
  listBankConnections: 'the household’s bank connections, capped by the Plaid Item limit',
  listGoals: 'the household’s own goals, a handful of rows it writes by hand',
  listCategoryRules: 'the household’s filing rules, in the order they run, which a page would break',
  getBudget: 'one month’s plan: a line per category the household planned for, and the month’s own totals',
  getBudgetHistory: 'at most six months, each one row of totals',
  getTransactionSummary: 'twelve months of totals, a fixed length',
  getMoneyOverview: 'the month in one answer: a few top categories and the newest few charges, both capped by the server',
  getSpendingTrends: 'at most twelve months, a category per top-level category and a capped list of merchants',
  listPeople: 'the household’s own people, a handful of rows, which pickers need whole',
  listTripGuests: 'one trip’s guest list, capped at MAX_TRIP_GUESTS, with its headcount',
  listSharedTrips: 'the trips other households let this account onto, a handful, read whole for one screen',
  syncChanges: 'it has its own cursor',
}

function isEndpoint(value: unknown): value is EndpointDefinition {
  return typeof value === 'object' && value !== null && 'method' in value && 'path' in value && 'response' in value
}

const endpoints = Object.entries(contracts).flatMap(([name, value]) => (isEndpoint(value) ? [{ name, endpoint: value }] : []))

function topLevelArrays(schema: z.ZodType): string[] {
  if (!(schema instanceof z.ZodObject)) return []
  return Object.entries(schema.shape).flatMap(([key, field]) => (field instanceof z.ZodArray ? [key] : []))
}

describe('page query', () => {
  it('defaults to 50 and reads the limit from a query string', () => {
    expect(pageQuerySchema.parse({})).toEqual({ limit: 50 })
    expect(pageQuerySchema.parse({ limit: '200', cursor: 'abc' })).toEqual({ limit: 200, cursor: 'abc' })
  })

  it('refuses a limit out of range and an empty or oversized cursor', () => {
    for (const query of [
      { limit: '0' },
      { limit: '201' },
      { limit: '2.5' },
      { limit: 'ten' },
      { cursor: '' },
      { cursor: 'x'.repeat(513) },
    ]) {
      expect(pageQuerySchema.safeParse(query).success, JSON.stringify(query)).toBe(false)
    }
  })

  it('shapes a page as items and a nullable next cursor', () => {
    const page = pageSchema(z.object({ id: z.string() }))
    expect(page.parse({ items: [{ id: 'a' }], nextCursor: null })).toEqual({ items: [{ id: 'a' }], nextCursor: null })
    expect(page.safeParse({ items: [{ id: 'a' }] }).success).toBe(false)
  })
})

describe('list endpoints', () => {
  it.each(PAGED)('%s pages with cursor and limit', name => {
    const endpoint = endpoints.find(entry => entry.name === name)?.endpoint
    expect(endpoint?.method).toBe('GET')
    expect(endpoint?.query?.parse({})).toMatchObject({ limit: 50 })
    expect(endpoint?.query?.safeParse({ limit: '500' }).success).toBe(false)
    const response = endpoint?.response
    expect(response).toBeInstanceOf(z.ZodObject)
    const shape = response instanceof z.ZodObject ? response.shape : {}
    expect(shape).toHaveProperty('items')
    expect(shape).toHaveProperty('nextCursor')
  })

  it('leave no other GET returning a bare list', () => {
    const unpaged = endpoints
      .filter(({ name, endpoint }) => endpoint.method === 'GET' && !(PAGED as readonly string[]).includes(name) && !(name in EXEMPT))
      .filter(({ endpoint }) => topLevelArrays(endpoint.response).length > 0)
      .map(({ name, endpoint }) => `${name} (${topLevelArrays(endpoint.response).join(', ')})`)
    expect(unpaged).toEqual([])
  })
})

describe('field gaps', () => {
  it('lets a transaction change its trip, its category, or both, but not neither', () => {
    const body = contracts.tagTransaction.body
    const categoryId = '6f1b2a9c-3d4e-4f5a-8b6c-7d8e9f0a1b2c'
    expect(body.safeParse({}).success).toBe(false)
    expect(body.safeParse({ tripId: null }).success).toBe(true)
    expect(body.safeParse({ categoryId }).success).toBe(true)
    expect(body.safeParse({ tripId: categoryId, categoryId }).success).toBe(true)
    expect(body.safeParse({ categoryId: 'food' }).success).toBe(false)
  })

  it('gives the decisions queue its trip and members', () => {
    expect(Object.keys(contracts.getDecisions.response.shape)).toEqual(expect.arrayContaining(['trip', 'members', 'decisions', 'slots']))
  })

  it('tells the calendar which sources it can offer', () => {
    expect(contracts.calendarFeedSchema.shape).toHaveProperty('availableSources')
  })

  it('counts booking drafts beside the bookings', () => {
    expect(contracts.listBookings.response.shape).toHaveProperty('draftCount')
  })

  it('lists time zones and currencies for a new household', () => {
    expect(contracts.getHouseholdOptions.method).toBe('GET')
    const options = { timeZones: ['UTC'], currencies: [{ code: 'USD', label: 'USD · US Dollar' }] }
    expect(contracts.getHouseholdOptions.response.parse(options)).toEqual(options)
    expect(contracts.getHouseholdOptions.response.safeParse({ ...options, currencies: [{ code: 'US', label: 'x' }] }).success).toBe(false)
  })
})
