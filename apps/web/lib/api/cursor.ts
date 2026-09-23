import 'server-only'
import { createHash } from 'node:crypto'
import { ValidationError } from '@ghar/core/errors'
import { INVALID_CURSOR, type Page, type PagePosition, type PageRequest } from '@ghar/db/queries'
import { z } from 'zod'

// The cursors the v1 list endpoints hand out. A cursor is base64url JSON holding the list it came
// from, a short hash of the filters it was issued under, and the last row's position: its sort keys
// and id. Clients treat it as opaque and send it back unchanged.
//
// It isn't signed. A cursor edited into another valid position only pages the caller's own
// household from a different row, and every value in it is checked again before it reaches SQL
// (@ghar/db's keysetAfter). What this file refuses is a cursor that can't be read, or one from a
// different list or different filters, where carrying on would skip or repeat rows.

const CURSOR_VERSION = 1

const cursorSchema = z.strictObject({
  v: z.literal(CURSOR_VERSION),
  /** The list and its order. */
  s: z.string().min(1).max(64),
  /** The filter hash. */
  f: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  /** The last row's sort keys. */
  k: z.array(z.string().max(400).nullable()).max(8),
  id: z.string().min(1).max(64),
})

const BASE64URL = /^[A-Za-z0-9_-]+$/

export type CursorFilterValue = string | number | boolean | null | undefined

export interface CursorScope {
  /** Names the list and its order, like `transactions:date-desc`. Change it when the order changes. */
  readonly sort: string
  /** Every filter that decides which rows are in the list. Undefined values are left out. */
  readonly filters?: Readonly<Record<string, CursorFilterValue>>
}

function invalidCursor(): ValidationError {
  return new ValidationError(INVALID_CURSOR, { details: { fieldErrors: { cursor: [INVALID_CURSOR] } } })
}

function filterHash(filters: CursorScope['filters']): string {
  const entries = Object.entries(filters ?? {})
    .filter(([, value]) => value !== undefined)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return createHash('sha256').update(JSON.stringify(entries)).digest('base64url').slice(0, 16)
}

export function encodeCursor(scope: CursorScope, position: PagePosition): string {
  const payload: z.infer<typeof cursorSchema> = {
    v: CURSOR_VERSION,
    s: scope.sort,
    f: filterHash(scope.filters),
    k: [...position.keys],
    id: position.id,
  }
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
}

/**
 * The position a cursor points after, or null for the first page. Throws ValidationError (400) for
 * a cursor that can't be read or was issued for another list or other filters.
 */
export function decodeCursor(raw: string | undefined, scope: CursorScope): PagePosition | null {
  if (raw === undefined) return null
  if (!BASE64URL.test(raw)) throw invalidCursor()

  let json: unknown
  try {
    json = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    throw invalidCursor()
  }
  const parsed = cursorSchema.safeParse(json)
  if (!parsed.success) throw invalidCursor()

  const cursor = parsed.data
  if (cursor.s !== scope.sort || cursor.f !== filterHash(scope.filters)) throw invalidCursor()
  return { keys: cursor.k, id: cursor.id }
}

/** The page request for a list endpoint's `cursor` and `limit`. */
export function pageRequest(query: { cursor?: string; limit: number }, scope: CursorScope): PageRequest {
  return { after: decodeCursor(query.cursor, scope), limit: query.limit }
}

export function nextCursor(page: Page<unknown>, scope: CursorScope): string | null {
  return page.next ? encodeCursor(scope, page.next) : null
}

/** A page as the contracts' `pageSchema` shapes it. */
export interface PageResult<Item> {
  items: Item[]
  nextCursor: string | null
}

export function pageResponse<Row, Item>(page: Page<Row>, scope: CursorScope, toItem: (row: Row) => Item): PageResult<Item> {
  return { items: page.rows.map(toItem), nextCursor: nextCursor(page, scope) }
}

/** Rows read per batch while filling a page in memory. The most one SQL page may hold. */
const FILL_BATCH = 200

/**
 * A page of only the rows that pass `keep`, for a filter SQL can't apply (word search runs in
 * @ghar/core). Reads keyset batches until it has one match past `limit` or the list ends, so a page
 * is never short while more matches remain, and its cursor is the last match it returns.
 */
export async function collectPage<Row>(
  fetchPage: (request: PageRequest) => Promise<Page<Row>>,
  request: PageRequest,
  keep: (row: Row) => boolean
): Promise<Page<Row>> {
  const rows: Row[] = []
  const positions: PagePosition[] = []
  let after = request.after ?? null

  for (;;) {
    const batch = await fetchPage({ after, limit: FILL_BATCH })
    batch.rows.forEach((row, index) => {
      const position = batch.positions[index]
      if (position && keep(row)) {
        rows.push(row)
        positions.push(position)
      }
    })
    if (rows.length > request.limit || batch.next === null) break
    after = batch.next
  }

  const kept = positions.slice(0, request.limit)
  const last = kept.at(-1)
  return { rows: rows.slice(0, request.limit), positions: kept, next: rows.length > request.limit && last ? last : null }
}
