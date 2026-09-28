import 'server-only'
import type { Person, RequestContext } from '@ghar/contracts'
import { todayInTimeZone } from '@ghar/core/dates'
import { comparePeople, personLabel } from '@ghar/core/people'
import * as queries from '@ghar/db/queries'
import type { PersonRow } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { getDb } from '@/lib/db'

// What the /api/v1/people routes and the pages call. The queries decide who may do what.

export function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    birthDate: row.birthDate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

/** Members first as they joined, then everyone added. */
export async function listPeople(ctx: RequestContext): Promise<Person[]> {
  return (await queries.listPeople(ctx, getDb())).map(toPerson)
}

/** A birth date can't be after today, in the household's zone. */
const householdToday = (session: Session) => todayInTimeZone(session.household.timeZone)

export async function createPerson(session: Session, body: { name: string; birthDate?: string | null }): Promise<Person> {
  return toPerson(await queries.createPerson(session.context, getDb(), body, householdToday(session)))
}

/** A new name, a birth date, or both. */
export async function updatePerson(
  session: Session,
  personId: string,
  body: { name?: string; birthDate?: string | null }
): Promise<Person> {
  return toPerson(await queries.updatePerson(session.context, getDb(), personId, body, householdToday(session)))
}

export async function deletePerson(ctx: RequestContext, personId: string): Promise<{ deleted: true }> {
  await queries.deletePerson(ctx, getDb(), personId)
  return { deleted: true }
}

export interface PersonOption {
  id: string
  label: string
}

/** For a picker: you first, then by name, each called what personLabel says. */
export async function listPersonOptions(ctx: RequestContext): Promise<PersonOption[]> {
  const people = await listPeople(ctx)
  const userId = ctx.userId
  return people
    .sort(comparePeople(userId))
    .map(person => ({ id: person.id, label: personLabel(person, userId), you: person.userId === userId }))
}

/** The label for whoever a document or renewal belongs to, for the caller. */
export function personNameFor(
  row: { personId: string | null; personName: string | null; personUserId: string | null },
  currentUserId: string
): string | null {
  if (row.personId === null) return null
  return personLabel({ id: row.personId, userId: row.personUserId, name: row.personName }, currentUserId)
}
