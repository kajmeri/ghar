import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { maintenanceStateSchema } from './home'
import { calendarDateSchema, httpUrlSchema, instantSchema, longTextSchema } from './shared'

export const contactSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  url: z.string().nullable(),
  notes: z.string().nullable(),
  tags: z.array(z.string()),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Contact = z.infer<typeof contactSchema>

/** A maintenance job a contact does. */
export const contactJobSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  assetId: z.uuid().nullable(),
  assetName: z.string().nullable(),
  nextDueOn: calendarDateSchema.nullable(),
  state: maintenanceStateSchema,
})
export type ContactJob = z.infer<typeof contactJobSchema>

export const contactParamsSchema = z.object({ contactId: z.uuid() })

/** Replaces every field on update. */
export const contactBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** "Plumber", "Pediatrician". */
  role: z.string().trim().min(1).max(80).nullable().default(null),
  phone: z.string().trim().min(1).max(40).nullable().default(null),
  email: z.email().max(254).nullable().default(null),
  url: httpUrlSchema.nullable().default(null),
  notes: longTextSchema.nullable().default(null),
  /** Stored lower case, without repeats. */
  tags: z.array(z.string().trim().min(1).max(32)).max(12).default([]),
})
export type ContactBody = z.output<typeof contactBodySchema>

/** By name. With `q`, only contacts matching every word, names starting with the first word leading. */
export const listContacts = defineEndpoint({
  method: 'GET',
  path: '/api/v1/contacts',
  query: z.object({
    /** Words to find in the name, role, phone, email, notes or tags. */
    q: z.string().max(200).optional(),
  }),
  response: z.object({ contacts: z.array(contactSchema) }),
})

export const getContact = defineEndpoint({
  method: 'GET',
  path: '/api/v1/contacts/:contactId',
  params: contactParamsSchema,
  response: z.object({ contact: contactSchema, jobs: z.array(contactJobSchema) }),
})

export const createContact = defineEndpoint({
  method: 'POST',
  path: '/api/v1/contacts',
  body: contactBodySchema,
  response: z.object({ contact: contactSchema }),
})

export const updateContact = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/contacts/:contactId',
  params: contactParamsSchema,
  body: contactBodySchema,
  response: z.object({ contact: contactSchema }),
})

/** Jobs that named this contact keep going without a vendor. */
export const deleteContact = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/contacts/:contactId',
  params: contactParamsSchema,
  response: z.object({ contactId: z.uuid() }),
})
