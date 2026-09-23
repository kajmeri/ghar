import { ValidationError } from '@ghar/core/errors'
import { and, asc, desc, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm'

// Keyset paging for the v1 list endpoints. A page asks for the rows after a position in the list's
// order, never for an offset, so a row added or removed while someone pages neither repeats nor
// skips one. Every order ends with the row's id, which makes each position unique.
//
// Sort keys travel as text: a timestamp as ISO 8601 with Postgres's full microseconds, because a
// JavaScript Date rounds to milliseconds and would lose rows that share one. Positions come from
// clients (inside an opaque cursor, but still from a client), so each value is checked before it
// reaches a query.

export type SortKeyKind = 'text' | 'date' | 'timestamp' | 'integer'

export interface SortKey {
  readonly expr: AnyColumn | SQL
  readonly kind: SortKeyKind
  readonly desc?: boolean
  /** Rows with no value come after every row with one, whichever the direction. */
  readonly nullable?: boolean
}

/** A list's order: its sort keys, then the row's id to break ties. */
export interface Keyset {
  readonly keys: readonly SortKey[]
  readonly id: AnyColumn
  readonly idDesc?: boolean
}

/** Where a row sits in its list's order. */
export interface PagePosition {
  readonly keys: readonly (string | null)[]
  readonly id: string
}

export interface PageRequest {
  /** The last row of the previous page. Null or absent for the first page. */
  readonly after?: PagePosition | null
  readonly limit: number
}

export interface Page<Row> {
  readonly rows: Row[]
  /** One per row, in the same order. */
  readonly positions: PagePosition[]
  /** The last row's position when more rows follow it, or null at the end of the list. */
  readonly next: PagePosition | null
}

export const INVALID_CURSOR = 'That page cursor is not valid. Start again from the first page.'

export function invalidCursor(): ValidationError {
  return new ValidationError(INVALID_CURSOR, { details: { fieldErrors: { cursor: [INVALID_CURSOR] } } })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
const INTEGER = /^-?\d{1,18}$/

function isValidKey(kind: SortKeyKind, value: string): boolean {
  switch (kind) {
    case 'text':
      return value.length <= 400
    case 'integer':
      return INTEGER.test(value)
    case 'date':
      return DATE.test(value) && roundTrips(`${value}T00:00:00.000Z`)
    case 'timestamp':
      return TIMESTAMP.test(value) && roundTrips(`${value.slice(0, 23)}Z`)
  }
}

/** Rejects dates that parse by rolling over, such as February 30th. */
function roundTrips(iso: string): boolean {
  const time = Date.parse(iso)
  return !Number.isNaN(time) && new Date(time).toISOString() === iso
}

const CASTS: Record<SortKeyKind, SQL> = {
  text: sql.raw('text'),
  date: sql.raw('date'),
  timestamp: sql.raw('timestamptz'),
  integer: sql.raw('bigint'),
}

/** The key as text, in the exact form a cursor carries and `keysetAfter` reads back. */
function keyAsText(key: SortKey): SQL {
  switch (key.kind) {
    case 'timestamp':
      return sql`to_char((${key.expr}) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
    case 'date':
      return sql`to_char(${key.expr}, 'YYYY-MM-DD')`
    default:
      return sql`(${key.expr})::text`
  }
}

/** Select this as `pageKeys` next to a list's columns, and hand the rows to `toPage`. */
export function pageKeys(keyset: Keyset): SQL<(string | null)[]> {
  const parts = [...keyset.keys.map(keyAsText), sql`(${keyset.id})::text`]
  return sql<(string | null)[]>`array[${sql.join(parts, sql`, `)}]`
}

/** The order a keyset pages through. Use it as the query's whole orderBy. */
export function keysetOrder(keyset: Keyset): SQL[] {
  const keys = keyset.keys.map(key =>
    key.nullable ? sql`${key.expr} ${sql.raw(key.desc ? 'desc' : 'asc')} nulls last` : key.desc ? desc(key.expr) : asc(key.expr)
  )
  return [...keys, keyset.idDesc ? desc(keyset.id) : asc(keyset.id)]
}

/** Rows strictly after `after` in the keyset's order, or undefined for the first page. */
export function keysetAfter(keyset: Keyset, after: PagePosition | null | undefined): SQL | undefined {
  if (!after) return undefined
  if (after.keys.length !== keyset.keys.length || !UUID.test(after.id)) throw invalidCursor()
  keyset.keys.forEach((key, index) => {
    const value = after.keys[index]
    if (value === undefined) throw invalidCursor()
    if (value === null ? !key.nullable : !isValidKey(key.kind, value)) throw invalidCursor()
  })

  const id = sql`${after.id}::uuid`
  const direction = keyset.idDesc ?? false

  // One direction and no nulls: a row comparison, which an index on the same columns can serve.
  if (keyset.keys.every(key => !key.nullable && (key.desc ?? false) === direction)) {
    const left = [...keyset.keys.map(key => sql`${key.expr}`), sql`${keyset.id}`]
    const right = [...keyset.keys.map((key, index) => param(key, after.keys[index] ?? null)), id]
    return sql`(${sql.join(left, sql`, `)}) ${sql.raw(direction ? '<' : '>')} (${sql.join(right, sql`, `)})`
  }

  // Otherwise: beyond on the first key, or level on it and beyond on the next, and so on to the id.
  const branches: SQL[] = []
  const level: SQL[] = []
  keyset.keys.forEach((key, index) => {
    const value = after.keys[index] ?? null
    const beyond = beyondKey(key, value)
    if (beyond) branches.push(and(...level, beyond) ?? beyond)
    level.push(value === null ? isNull(key.expr) : sql`${key.expr} = ${param(key, value)}`)
  })
  const beyondId = sql`${keyset.id} ${sql.raw(direction ? '<' : '>')} ${id}`
  branches.push(and(...level, beyondId) ?? beyondId)
  return or(...branches)
}

function param(key: SortKey, value: string | null): SQL {
  return sql`${value}::${CASTS[key.kind]}`
}

/** Rows past `value` on this key alone. Nothing sorts past a null, since nulls come last. */
function beyondKey(key: SortKey, value: string | null): SQL | undefined {
  if (value === null) return undefined
  const past = sql`${key.expr} ${sql.raw(key.desc ? '<' : '>')} ${param(key, value)}`
  return key.nullable ? (or(past, isNull(key.expr)) ?? past) : past
}

/** Takes rows fetched with `limit + 1` and a `pageKeys` column, and splits off the extra row. */
export function toPage<T extends { pageKeys: (string | null)[] }>(fetched: readonly T[], limit: number): Page<Omit<T, 'pageKeys'>> {
  const rows: Omit<T, 'pageKeys'>[] = []
  const positions: PagePosition[] = []
  for (const { pageKeys: keys, ...row } of fetched.slice(0, limit)) {
    const id = keys.at(-1)
    if (typeof id !== 'string') throw new Error('A paged row came back without its id')
    positions.push({ keys: keys.slice(0, -1), id })
    rows.push(row)
  }
  const last = positions.at(-1)
  return { rows, positions, next: fetched.length > limit && last ? last : null }
}
