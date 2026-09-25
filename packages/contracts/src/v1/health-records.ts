import { z } from 'zod'
import { defineEndpoint } from '../endpoint'
import { calendarDateSchema, instantSchema, pageQuerySchema, pageSchema, queryBooleanSchema } from './shared'

// Health records: visits and shots, one person at a time. Owners and adults see and log everyone's;
// anyone else sees only their own, and members log their own. A record the caller can't see is
// 404, the same as one that doesn't exist.

/** Mirrors HEALTH_EVENT_KINDS in @ghar/core/health. A test keeps them equal. */
export const healthEventKindSchema = z.enum(['vaccine', 'checkup', 'dental', 'eye', 'visit', 'test'])
export type HealthEventKindValue = z.infer<typeof healthEventKindSchema>

/** HEALTH_TITLE_MAX_LENGTH and HEALTH_NOTE_MAX_LENGTH in @ghar/core/health. */
export const HEALTH_TITLE_MAX = 120
export const HEALTH_NOTE_MAX = 1000

export const healthEventSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  /** What to call them, as personLabel says it for the caller: "You", or their name. */
  personName: z.string(),
  kind: healthEventKindSchema,
  /** What was typed, or the kind's name when nothing was. */
  title: z.string(),
  /** The day it happened, in the household's calendar. Never in the future. */
  occurredOn: calendarDateSchema,
  /** The doctor, dentist or clinic. */
  contactId: z.uuid().nullable(),
  contactName: z.string().nullable(),
  /** A certificate or summary. Its title is null when the caller can't see that document. */
  documentId: z.uuid().nullable(),
  documentTitle: z.string().nullable(),
  note: z.string().nullable(),
  /** Whether the caller may edit or delete it. */
  canEdit: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type HealthEvent = z.infer<typeof healthEventSchema>

export const healthPersonSchema = z.object({
  id: z.uuid(),
  /** "You", or their name. */
  name: z.string(),
  /** Whether the caller may log for them. */
  canLog: z.boolean(),
  eventCount: z.int().min(0),
  /** When their latest record happened. Null when they have none. */
  lastOn: calendarDateSchema.nullable(),
})
export type HealthPerson = z.infer<typeof healthPersonSchema>

/** The people whose records the caller may see: everyone for owners and adults, otherwise just them. You first. */
export const listHealthPeople = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/people',
  response: z.object({ people: z.array(healthPersonSchema) }),
})

export const healthEventParamsSchema = z.object({ eventId: z.uuid() })

/** Every field. Replaces them all on update. */
export const healthEventBodySchema = z.object({
  personId: z.uuid(),
  kind: healthEventKindSchema,
  /** Leave it out or blank for the kind's name: "Dentist" is often enough. */
  title: z.string().trim().max(HEALTH_TITLE_MAX).nullable().default(null),
  occurredOn: calendarDateSchema,
  contactId: z.uuid().nullable().default(null),
  documentId: z.uuid().nullable().default(null),
  /** Short, on purpose. Results and reports belong in documents, marked sensitive. */
  note: z.string().trim().max(HEALTH_NOTE_MAX).nullable().default(null),
})
export type HealthEventBody = z.output<typeof healthEventBodySchema>

/** Newest first. With `personId`, only theirs; 404-free, so someone the caller can't see gives an empty list. */
export const listHealthEvents = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/events',
  query: pageQuerySchema.extend({ personId: z.uuid().optional() }),
  response: pageSchema(healthEventSchema),
})

export const getHealthEvent = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/events/:eventId',
  params: healthEventParamsSchema,
  response: z.object({ event: healthEventSchema }),
})

/**
 * 404 when the person isn't one the caller can see, 403 when they can see but not log for them (a
 * viewer), 400 for a date in the future or a contact or document from outside the household.
 */
export const createHealthEvent = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/events',
  body: healthEventBodySchema,
  response: z.object({ event: healthEventSchema }),
})

export const updateHealthEvent = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/health-records/events/:eventId',
  params: healthEventParamsSchema,
  body: healthEventBodySchema,
  response: z.object({ event: healthEventSchema }),
})

export const deleteHealthEvent = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/health-records/events/:eventId',
  params: healthEventParamsSchema,
  response: z.object({ eventId: z.uuid() }),
})

// What's due: schedules. A schedule's next due date is worked out from the records that match it,
// so logging a visit moves it and nothing else has to.

/** HEALTH_CADENCE_MONTHS_MIN and _MAX in @ghar/core/health. */
export const HEALTH_CADENCE_MIN = 1
export const HEALTH_CADENCE_MAX = 120

export const healthDueStateSchema = z.enum(['overdue', 'due_soon', 'scheduled'])

export const healthScheduleSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  /** "You", or their name. */
  personName: z.string(),
  kind: healthEventKindSchema,
  /** Only records with this title count, like "Flu shot". Null for any record of the kind. */
  title: z.string().nullable(),
  /** What to call it: the title, or the kind's name. */
  name: z.string(),
  cadenceMonths: z.int().min(HEALTH_CADENCE_MIN).max(HEALTH_CADENCE_MAX),
  /** It's due no earlier than this, whatever was logged before. */
  firstDueOn: calendarDateSchema,
  /** The newest record that matches. Null when nothing does yet. */
  lastOn: calendarDateSchema.nullable(),
  dueOn: calendarDateSchema,
  /** Due soon means within 30 days. */
  state: healthDueStateSchema,
  canEdit: z.boolean(),
})
export type HealthSchedule = z.infer<typeof healthScheduleSchema>

export const healthScheduleParamsSchema = z.object({ scheduleId: z.uuid() })

export const healthScheduleBodySchema = z.object({
  personId: z.uuid(),
  kind: healthEventKindSchema,
  /** Leave it out to count any record of the kind. */
  title: z.string().trim().max(HEALTH_TITLE_MAX).nullable().default(null),
  cadenceMonths: z.int().min(HEALTH_CADENCE_MIN).max(HEALTH_CADENCE_MAX),
  firstDueOn: calendarDateSchema,
})
export type HealthScheduleBody = z.output<typeof healthScheduleBodySchema>

/** Soonest due first. With `personId`, only theirs; someone the caller can't see gives an empty list. */
export const listHealthSchedules = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/schedules',
  query: z.object({ personId: z.uuid().optional() }),
  response: z.object({ schedules: z.array(healthScheduleSchema) }),
})

/** 400 when that person already has a schedule for the same kind and title. Otherwise as createHealthEvent. */
export const createHealthSchedule = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/schedules',
  body: healthScheduleBodySchema,
  response: z.object({ schedule: healthScheduleSchema }),
})

export const updateHealthSchedule = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/health-records/schedules/:scheduleId',
  params: healthScheduleParamsSchema,
  body: healthScheduleBodySchema,
  response: z.object({ schedule: healthScheduleSchema }),
})

/** The records it counted stay. */
export const deleteHealthSchedule = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/health-records/schedules/:scheduleId',
  params: healthScheduleParamsSchema,
  response: z.object({ scheduleId: z.uuid() }),
})

// Medicines: what someone takes now, and what they used to. Stopping one keeps it as history.

/** MEDICINE_NAME_MAX_LENGTH, MEDICINE_DOSE_MAX_LENGTH and MEDICINE_SUPPLY_DAYS_MIN and _MAX in @ghar/core/health. */
export const MEDICINE_NAME_MAX = 120
export const MEDICINE_DOSE_MAX = 120
export const MEDICINE_SUPPLY_DAYS_MIN = 1
export const MEDICINE_SUPPLY_DAYS_MAX = 365

/** Due soon means within 7 days. */
export const medicineRefillStateSchema = z.enum(['overdue', 'due_soon', 'later'])

export const healthMedicineSchema = z.object({
  id: z.uuid(),
  personId: z.uuid(),
  /** "You", or their name. */
  personName: z.string(),
  name: z.string(),
  /** As the label says it: "500 mg twice a day". */
  dose: z.string().nullable(),
  /** Who prescribed it. */
  contactId: z.uuid().nullable(),
  contactName: z.string().nullable(),
  startedOn: calendarDateSchema.nullable(),
  /** The first day it wasn't taken. Null while it still is. */
  stoppedOn: calendarDateSchema.nullable(),
  /** Always null once stopped. */
  refillBy: calendarDateSchema.nullable(),
  /** Null without a refill date. */
  refillState: medicineRefillStateSchema.nullable(),
  /** How many days one refill lasts. Refilling needs it. */
  supplyDays: z.int().min(MEDICINE_SUPPLY_DAYS_MIN).max(MEDICINE_SUPPLY_DAYS_MAX).nullable(),
  lastRefilledOn: calendarDateSchema.nullable(),
  note: z.string().nullable(),
  canEdit: z.boolean(),
  createdAt: instantSchema,
  updatedAt: instantSchema,
})
export type HealthMedicine = z.infer<typeof healthMedicineSchema>

export const healthMedicineParamsSchema = z.object({ medicineId: z.uuid() })

/** Every field. Replaces them all on update: set `stoppedOn` to stop it, clear it to start again. */
export const healthMedicineBodySchema = z.object({
  personId: z.uuid(),
  name: z.string().trim().min(1).max(MEDICINE_NAME_MAX),
  dose: z.string().trim().max(MEDICINE_DOSE_MAX).nullable().default(null),
  contactId: z.uuid().nullable().default(null),
  startedOn: calendarDateSchema.nullable().default(null),
  /** Never after today. A refill date sent with it is dropped. */
  stoppedOn: calendarDateSchema.nullable().default(null),
  refillBy: calendarDateSchema.nullable().default(null),
  supplyDays: z.int().min(MEDICINE_SUPPLY_DAYS_MIN).max(MEDICINE_SUPPLY_DAYS_MAX).nullable().default(null),
  note: z.string().trim().max(HEALTH_NOTE_MAX).nullable().default(null),
})
export type HealthMedicineBody = z.output<typeof healthMedicineBodySchema>

/**
 * Current ones by name, then stopped ones, most recently stopped first. With `personId`, only
 * theirs; with `current=true`, only what's still being taken.
 */
export const listHealthMedicines = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/medicines',
  query: z.object({
    personId: z.uuid().optional(),
    current: queryBooleanSchema.default(false),
  }),
  response: z.object({ medicines: z.array(healthMedicineSchema) }),
})

export const getHealthMedicine = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/medicines/:medicineId',
  params: healthMedicineParamsSchema,
  response: z.object({ medicine: healthMedicineSchema }),
})

/** Permissions as createHealthEvent. 400 for a stop date in the future or before it started. */
export const createHealthMedicine = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/medicines',
  body: healthMedicineBodySchema,
  response: z.object({ medicine: healthMedicineSchema }),
})

export const updateHealthMedicine = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/health-records/medicines/:medicineId',
  params: healthMedicineParamsSchema,
  body: healthMedicineBodySchema,
  response: z.object({ medicine: healthMedicineSchema }),
})

/** Stopped today, where the household is. Its refill date goes; the rest stays as history. Stopping twice is a no-op. */
export const stopHealthMedicine = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/medicines/:medicineId/stop',
  params: healthMedicineParamsSchema,
  response: z.object({ medicine: healthMedicineSchema }),
})

/** Refilled today: the next refill is `supplyDays` from now. 400 when it's stopped or has no supply length. */
export const refillHealthMedicine = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/medicines/:medicineId/refill',
  params: healthMedicineParamsSchema,
  response: z.object({ medicine: healthMedicineSchema }),
})

/** For a mistake. Stop it instead to keep the history. */
export const deleteHealthMedicine = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/health-records/medicines/:medicineId',
  params: healthMedicineParamsSchema,
  response: z.object({ medicineId: z.uuid() }),
})
