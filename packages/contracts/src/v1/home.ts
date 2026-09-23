import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { documentSchema, expiryStateSchema, reminderLeadDaysSchema, remindFromDaysSchema } from './documents'
import { calendarDateSchema, centsSchema, instantSchema, longTextSchema, pageQuerySchema, pageSchema } from './shared'

// These lists mirror @ghar/core/home. A test keeps them equal.
export const assetKindSchema = z.enum(['vehicle', 'appliance', 'system', 'electronics', 'property', 'other'])
export type AssetKindValue = z.infer<typeof assetKindSchema>
export const maintenanceStateSchema = z.enum(['overdue', 'due_soon', 'scheduled', 'unscheduled'])
export type MaintenanceStateValue = z.infer<typeof maintenanceStateSchema>

const homeTextSchema = z.string().trim().min(1).max(120)

export const assetSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: assetKindSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  purchasedOn: calendarDateSchema.nullable(),
  purchasePriceCents: centsSchema.nullable(),
  warrantyExpiresOn: calendarDateSchema.nullable(),
  /** Null when there's no warranty date. */
  warrantyState: expiryStateSchema.nullable(),
  warrantyRemindFromDays: remindFromDaysSchema,
  warrantyReminderLeadDays: reminderLeadDaysSchema,
  location: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type Asset = z.infer<typeof assetSchema>

export const assetListItemSchema = assetSchema.extend({
  /** The open job due soonest. */
  nextTask: z
    .object({
      id: z.uuid(),
      title: z.string(),
      nextDueOn: calendarDateSchema.nullable(),
      state: maintenanceStateSchema,
    })
    .nullable(),
  /** Documents the signed-in person can see. */
  documentCount: z.int(),
})
export type AssetListItem = z.infer<typeof assetListItemSchema>

export const assetParamsSchema = z.object({ assetId: z.uuid() })

/** Replaces every field on update. */
export const assetBodySchema = z.object({
  name: homeTextSchema,
  kind: assetKindSchema.default('other'),
  make: homeTextSchema.nullable().default(null),
  model: homeTextSchema.nullable().default(null),
  serialNumber: homeTextSchema.nullable().default(null),
  purchasedOn: calendarDateSchema.nullable().default(null),
  purchasePriceCents: centsSchema.min(0).max(10_000_000_000).nullable().default(null),
  warrantyExpiresOn: calendarDateSchema.nullable().default(null),
  warrantyRemindFromDays: remindFromDaysSchema.default(null),
  location: homeTextSchema.nullable().default(null),
  notes: longTextSchema.nullable().default(null),
})
export type AssetBody = z.output<typeof assetBodySchema>

export const maintenanceVendorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  role: z.string().nullable(),
  phone: z.string().nullable(),
})

export const maintenanceTaskSchema = z.object({
  id: z.uuid(),
  /** Null for a job about the house in general. */
  assetId: z.uuid().nullable(),
  assetName: z.string().nullable(),
  title: z.string(),
  cadenceMonths: z.int().nullable(),
  cadenceMiles: z.int().nullable(),
  /** "Every 6 months or 5,000 miles". Null for a one-off job. */
  cadence: z.string().nullable(),
  lastDoneOn: calendarDateSchema.nullable(),
  nextDueOn: calendarDateSchema.nullable(),
  state: maintenanceStateSchema,
  assignedUserId: z.uuid().nullable(),
  instructions: z.string().nullable(),
  /** Who does the work, from contacts. */
  vendor: maintenanceVendorSchema.nullable(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type MaintenanceTask = z.infer<typeof maintenanceTaskSchema>

export const maintenanceLogEntrySchema = z.object({
  id: z.uuid(),
  maintenanceId: z.uuid(),
  taskTitle: z.string(),
  completedOn: calendarDateSchema,
  completedBy: z.uuid().nullable(),
  costCents: centsSchema.nullable(),
  notes: z.string().nullable(),
  /** The receipt or invoice, if one was attached and the signed-in person can see it. */
  documentId: z.uuid().nullable(),
  createdAt: instantSchema,
})
export type MaintenanceLogEntry = z.infer<typeof maintenanceLogEntrySchema>

export const maintenanceParamsSchema = z.object({ taskId: z.uuid() })
export const maintenanceCompletionParamsSchema = z.object({ taskId: z.uuid(), entryId: z.uuid() })

/** Replaces every field on update. */
export const maintenanceBodySchema = z.object({
  title: homeTextSchema,
  assetId: z.uuid().nullable().default(null),
  /** Null for a one-off job. */
  cadenceMonths: z.int().min(1).max(120).nullable().default(null),
  cadenceMiles: z.int().min(1).max(500_000).nullable().default(null),
  lastDoneOn: calendarDateSchema.nullable().default(null),
  /** Leave null to work it out from the cadence and the last time it was done. */
  nextDueOn: calendarDateSchema.nullable().default(null),
  assignedUserId: z.uuid().nullable().default(null),
  instructions: longTextSchema.nullable().default(null),
  vendorContactId: z.uuid().nullable().default(null),
})
export type MaintenanceBody = z.output<typeof maintenanceBodySchema>

export const completeMaintenanceBodySchema = z.object({
  /** Today in the household's zone when left out. */
  completedOn: calendarDateSchema.optional(),
  costCents: centsSchema.min(0).max(100_000_000).nullable().default(null),
  notes: longTextSchema.nullable().default(null),
  documentId: z.uuid().nullable().default(null),
})
export type CompleteMaintenanceBody = z.output<typeof completeMaintenanceBodySchema>

/** By name, ignoring case. With `q`, only assets matching every word. */
export const listAssets = defineEndpoint({
  method: 'GET',
  path: '/api/v1/assets',
  query: pageQuerySchema.extend({
    /** Words to find in the name, make, model, serial number or location. */
    q: z.string().max(200).optional(),
  }),
  response: pageSchema(assetListItemSchema),
})

/** The asset with its jobs (soonest due first), its documents and every time a job was done. */
export const getAsset = defineEndpoint({
  method: 'GET',
  path: '/api/v1/assets/:assetId',
  params: assetParamsSchema,
  response: z.object({
    asset: assetSchema,
    tasks: z.array(maintenanceTaskSchema),
    documents: z.array(documentSchema),
    history: z.array(maintenanceLogEntrySchema),
  }),
})

export const createAsset = defineEndpoint({
  method: 'POST',
  path: '/api/v1/assets',
  body: assetBodySchema,
  response: z.object({ asset: assetSchema }),
})

export const updateAsset = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/assets/:assetId',
  params: assetParamsSchema,
  body: assetBodySchema,
  response: z.object({ asset: assetSchema }),
})

/** Deletes the asset with its jobs and their history. Its documents stay, unlinked. */
export const deleteAsset = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/assets/:assetId',
  params: assetParamsSchema,
  response: z.object({ assetId: z.uuid() }),
})

/** Every job, soonest due first, then by title; jobs with no due date last. */
export const listMaintenance = defineEndpoint({
  method: 'GET',
  path: '/api/v1/maintenance',
  query: pageQuerySchema,
  response: pageSchema(maintenanceTaskSchema),
})

export const getMaintenanceTask = defineEndpoint({
  method: 'GET',
  path: '/api/v1/maintenance/:taskId',
  params: maintenanceParamsSchema,
  response: z.object({ task: maintenanceTaskSchema, history: z.array(maintenanceLogEntrySchema) }),
})

export const createMaintenanceTask = defineEndpoint({
  method: 'POST',
  path: '/api/v1/maintenance',
  body: maintenanceBodySchema,
  response: z.object({ task: maintenanceTaskSchema }),
})

export const updateMaintenanceTask = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/maintenance/:taskId',
  params: maintenanceParamsSchema,
  body: maintenanceBodySchema,
  response: z.object({ task: maintenanceTaskSchema }),
})

export const deleteMaintenanceTask = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/maintenance/:taskId',
  params: maintenanceParamsSchema,
  response: z.object({ taskId: z.uuid() }),
})

/**
 * Mark done: logs the work and rolls the next due date one cadence past it. Logging an older
 * completion fills in history without moving the schedule.
 */
export const completeMaintenanceTask = defineEndpoint({
  method: 'POST',
  path: '/api/v1/maintenance/:taskId/completions',
  params: maintenanceParamsSchema,
  body: completeMaintenanceBodySchema,
  response: z.object({ task: maintenanceTaskSchema, entry: maintenanceLogEntrySchema }),
})

/** Takes back a completion logged by mistake, and works the schedule out again from what's left. */
export const deleteMaintenanceCompletion = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/maintenance/:taskId/completions/:entryId',
  params: maintenanceCompletionParamsSchema,
  response: z.object({ task: maintenanceTaskSchema }),
})
