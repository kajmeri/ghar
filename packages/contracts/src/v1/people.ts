import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, instantSchema } from './shared'

/** Mirrors PERSON_NAME_MAX_LENGTH in @ghar/core/people. */
export const PERSON_NAME_MAX = 100

/**
 * One of the household's people: a member, or someone without an account, like a child. Documents,
 * renewals and trip travellers point at these. Clients name them with personLabel in @ghar/core.
 */
export const personSchema = z.object({
  id: z.uuid(),
  /** Null for someone without an account. */
  userId: z.uuid().nullable(),
  /** Their own name, or the one on their profile. Null for a member who hasn't set one. */
  name: z.string().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Person = z.infer<typeof personSchema>

export const personParamsSchema = z.object({ personId: z.uuid() })

export const personBodySchema = z.object({ name: z.string().trim().min(1, 'Give them a name').max(PERSON_NAME_MAX) })

/** Everyone: members first as they joined, then everyone added. A household is small, so it's one page. */
export const listPeople = defineEndpoint({
  method: 'GET',
  path: '/api/v1/people',
  response: z.object({ people: z.array(personSchema) }),
})

/** Owners and adults. Someone without an account; members join by invitation. */
export const createPerson = defineEndpoint({
  method: 'POST',
  path: '/api/v1/people',
  body: personBodySchema,
  response: z.object({ person: personSchema }),
})

/** Owners and adults, and only for someone without an account. */
export const updatePerson = defineEndpoint({
  method: 'PATCH',
  path: '/api/v1/people/:personId',
  params: personParamsSchema,
  body: personBodySchema,
  response: z.object({ person: personSchema }),
})

/** Owners and adults, and only for someone without an account. Their documents stay, belonging to nobody. */
export const deletePerson = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/people/:personId',
  params: personParamsSchema,
  response: z.object({ deleted: z.literal(true) }),
})

/** Mirrors TripDocumentIssueKind in @ghar/core/people. */
export const tripDocumentIssueKindSchema = z.enum(['no_passport', 'no_expiry_date', 'expires_before_return', 'under_six_months'])

export const tripDocumentIssueSchema = z.object({
  personId: z.uuid(),
  kind: tripDocumentIssueKindSchema,
  /** The passport it's about. Null when there isn't one. */
  documentId: z.uuid().nullable(),
  expiresOn: calendarDateSchema.nullable(),
})
export type TripDocumentIssueValue = z.infer<typeof tripDocumentIssueSchema>
