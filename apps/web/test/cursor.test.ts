import { ValidationError } from '@ghar/core/errors'
import type { Page, PagePosition, PageRequest } from '@ghar/db/queries'
import { describe, expect, it } from 'vitest'
import { collectPage, decodeCursor, encodeCursor, nextCursor, pageRequest, pageResponse } from '@/lib/api/cursor'

const scope = { sort: 'transactions:date-desc', filters: { tripId: 'trip-1', untagged: undefined } }
const position: PagePosition = { keys: ['2026-09-01', null], id: '0b8f1c4e-8d1a-4a52-9d53-3f3f6c1f0a11' }

function base64url(value: unknown): string {
  return Buffer.from(typeof value === 'string' ? value : JSON.stringify(value), 'utf8').toString('base64url')
}

/** The JSON inside a cursor, to edit and encode again. */
function payloadOf(cursor: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('cursor codec', () => {
  it('round-trips a position, null keys included', () => {
    const cursor = encodeCursor(scope, position)
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeCursor(cursor, scope)).toEqual(position)
  })

  it('reads no cursor as the first page', () => {
    expect(decodeCursor(undefined, scope)).toBeNull()
    expect(pageRequest({ limit: 25 }, scope)).toEqual({ after: null, limit: 25 })
  })

  it('carries the position into a page request', () => {
    expect(pageRequest({ cursor: encodeCursor(scope, position), limit: 10 }, scope)).toEqual({ after: position, limit: 10 })
  })

  it('ignores filter order and filters left undefined', () => {
    const cursor = encodeCursor({ sort: 'trips:starts-on', filters: { phase: 'upcoming', status: undefined, today: '2026-09-14' } }, position)
    expect(decodeCursor(cursor, { sort: 'trips:starts-on', filters: { today: '2026-09-14', phase: 'upcoming' } })).toEqual(position)
  })

  it('refuses a cursor from another list', () => {
    const cursor = encodeCursor(scope, position)
    expect(() => decodeCursor(cursor, { ...scope, sort: 'contacts:name' })).toThrow(ValidationError)
  })

  it('refuses a cursor issued under other filters', () => {
    const cursor = encodeCursor(scope, position)
    expect(() => decodeCursor(cursor, { ...scope, filters: { tripId: 'trip-2' } })).toThrow(ValidationError)
    expect(() => decodeCursor(cursor, { ...scope, filters: { tripId: 'trip-1', untagged: true } })).toThrow(ValidationError)
    expect(() => decodeCursor(cursor, { sort: scope.sort })).toThrow(ValidationError)
  })

  it('refuses a tampered cursor', () => {
    const payload = payloadOf(encodeCursor(scope, position))
    const tampered = [
      'not base64!',
      base64url('not json'),
      base64url([1, 2, 3]),
      base64url({ ...payload, v: 2 }),
      base64url({ ...payload, extra: true }),
      base64url({ ...payload, id: '' }),
      base64url({ ...payload, k: 'not a list' }),
      base64url({ ...payload, f: 'has spaces in it' }),
      base64url({ ...payload, s: 'contacts:name' }),
    ]
    for (const cursor of tampered) {
      expect(() => decodeCursor(cursor, scope), cursor).toThrow(ValidationError)
    }
  })

  it('says which field was wrong', () => {
    try {
      decodeCursor('bad cursor', scope)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect(JSON.stringify(error instanceof ValidationError ? error.details : null)).toContain('cursor')
    }
  })

  it('gives a next cursor only when the page says more rows follow', () => {
    const last: Page<string> = { rows: ['a'], positions: [position], next: null }
    const more: Page<string> = { ...last, next: position }
    expect(nextCursor(last, scope)).toBeNull()
    expect(pageResponse(last, scope, row => row.toUpperCase())).toEqual({ items: ['A'], nextCursor: null })
    const response = pageResponse(more, scope, row => row)
    expect(response.nextCursor).not.toBeNull()
    expect(decodeCursor(response.nextCursor ?? undefined, scope)).toEqual(position)
  })
})

/** A keyset list of the numbers 1 to count, read the way @ghar/db reads a page: limit + 1 rows. */
function numberList(count: number) {
  const requests: PageRequest[] = []
  const fetchPage = async (request: PageRequest): Promise<Page<number>> => {
    requests.push(request)
    const start = request.after ? Number(request.after.id) : 0
    const fetched = Array.from({ length: Math.max(0, Math.min(request.limit + 1, count - start)) }, (_, index) => start + index + 1)
    const rows = fetched.slice(0, request.limit)
    const positions = rows.map(n => ({ keys: [String(n)], id: String(n) }))
    return { rows, positions, next: fetched.length > request.limit ? (positions.at(-1) ?? null) : null }
  }
  return { fetchPage, requests }
}

describe('collectPage', () => {
  it('fills a page with matches and continues after the last one', async () => {
    const { fetchPage } = numberList(1000)
    const even = (n: number) => n % 2 === 0

    const first = await collectPage(fetchPage, { after: null, limit: 10 }, even)
    expect(first.rows).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    expect(first.next).toEqual({ keys: ['20'], id: '20' })

    const second = await collectPage(fetchPage, { after: first.next, limit: 10 }, even)
    expect(second.rows[0]).toBe(22)
    expect(second.positions).toHaveLength(10)
  })

  it('reads batch after batch when matches are sparse', async () => {
    const { fetchPage, requests } = numberList(1000)
    const page = await collectPage(fetchPage, { after: null, limit: 2 }, n => n % 150 === 0)
    expect(page.rows).toEqual([150, 300])
    expect(page.next).toEqual({ keys: ['300'], id: '300' })
    // 150, 300 and 450 are in the first three batches; the third shows there is more.
    expect(requests).toHaveLength(3)
  })

  it('ends with no next cursor when the matches run out', async () => {
    const { fetchPage } = numberList(1000)
    const page = await collectPage(fetchPage, { after: null, limit: 10 }, n => n % 150 === 0)
    expect(page.rows).toEqual([150, 300, 450, 600, 750, 900])
    expect(page.next).toBeNull()
  })

  it('never ends a page early when exactly limit matches remain', async () => {
    const { fetchPage } = numberList(400)
    const page = await collectPage(fetchPage, { after: null, limit: 2 }, n => n % 200 === 0)
    expect(page.rows).toEqual([200, 400])
    expect(page.next).toBeNull()
  })

  it('returns an empty last page', async () => {
    const { fetchPage } = numberList(0)
    expect(await collectPage(fetchPage, { after: null, limit: 5 }, () => true)).toEqual({ rows: [], positions: [], next: null })
  })
})
