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

/**
 * Refilled on `refilledOn`, today if left out: the next refill is `supplyDays` after it. 400 when
 * it's stopped, has no supply length, or the day is in the future or before its last refill.
 */
export const refillHealthMedicine = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/medicines/:medicineId/refill',
  params: healthMedicineParamsSchema,
  body: z.object({ refilledOn: calendarDateSchema.optional() }).prefault({}),
  response: z.object({ medicine: healthMedicineSchema }),
})

/**
 * Takes back the refill on `refilledOn`, putting the refill dates back as they were. 409 when it
 * has been refilled again or stopped since, so a later change is never undone with it.
 */
export const undoHealthMedicineRefill = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/medicines/:medicineId/refill/undo',
  params: healthMedicineParamsSchema,
  body: z.object({
    refilledOn: calendarDateSchema,
    previousRefillBy: calendarDateSchema.nullable(),
    /** Before `refilledOn`, or null. */
    previousLastRefilledOn: calendarDateSchema.nullable(),
  }),
  response: z.object({ medicine: healthMedicineSchema }),
})

/** For a mistake. Stop it instead to keep the history. */
export const deleteHealthMedicine = defineEndpoint({
  method: 'DELETE',
  path: '/api/v1/health-records/medicines/:medicineId',
  params: healthMedicineParamsSchema,
  response: z.object({ medicineId: z.uuid() }),
})

// ---------------------------------------------------------------------------------------------
// Health card
// ---------------------------------------------------------------------------------------------

/** Mirrors BLOOD_TYPES in @ghar/core/health. A test keeps them equal. */
export const bloodTypeSchema = z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])
export type BloodTypeValue = z.infer<typeof bloodTypeSchema>

/** HEALTH_CARD_ITEM_MAX_LENGTH, HEALTH_CARD_ITEMS_MAX and HEALTH_CARD_NOTE_MAX_LENGTH in @ghar/core/health. */
export const HEALTH_CARD_ITEM_MAX = 80
export const HEALTH_CARD_ITEMS_MAX = 20
export const HEALTH_CARD_NOTE_MAX = 300

/**
 * What someone helping a person would need to know. Every person the caller may see has one, blank
 * until something goes on it. Current medicines come from their medicines, not from the card.
 */
export const healthCardSchema = z.object({
  personId: z.uuid(),
  /** "You", or their name. */
  personName: z.string(),
  bloodType: bloodTypeSchema.nullable(),
  allergies: z.array(z.string()),
  conditions: z.array(z.string()),
  /** Their doctor, as a contact. */
  doctorContactId: z.uuid().nullable(),
  doctorName: z.string().nullable(),
  doctorPhone: z.string().nullable(),
  /** A photo or scan of their insurance card. Its title is null when the caller can't open it. */
  insuranceDocumentId: z.uuid().nullable(),
  insuranceDocumentTitle: z.string().nullable(),
  /** For whoever's helping, like "Carries an EpiPen in her bag". */
  emergencyNote: z.string().nullable(),
  /** What they take now, by name. */
  medicines: z.array(z.object({ id: z.uuid(), name: z.string(), dose: z.string().nullable() })),
  canEdit: z.boolean(),
  /** Null until something has been saved. */
  updatedAt: instantSchema.nullable(),
})
export type HealthCard = z.infer<typeof healthCardSchema>

const healthCardItemsSchema = z.array(z.string().trim().max(HEALTH_CARD_ITEM_MAX)).max(HEALTH_CARD_ITEMS_MAX).default([])

/** The whole card. Replaces every field; blanks and repeats in the lists are dropped. */
export const healthCardBodySchema = z.object({
  bloodType: bloodTypeSchema.nullable().default(null),
  allergies: healthCardItemsSchema,
  conditions: healthCardItemsSchema,
  doctorContactId: z.uuid().nullable().default(null),
  /** One the caller can't open may stay when it's already on the card, but can't be newly linked. */
  insuranceDocumentId: z.uuid().nullable().default(null),
  emergencyNote: z.string().trim().max(HEALTH_CARD_NOTE_MAX).nullable().default(null),
})
export type HealthCardBody = z.output<typeof healthCardBodySchema>

export const healthPersonParamsSchema = z.object({ personId: z.uuid() })

/** Everyone's cards the caller may see, oldest person first, blank ones included. With `personId`, only theirs. */
export const listHealthCards = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/cards',
  query: z.object({ personId: z.uuid().optional() }),
  response: z.object({ cards: z.array(healthCardSchema) }),
})

/** 404 for someone the caller can't see. */
export const getHealthCard = defineEndpoint({
  method: 'GET',
  path: '/api/v1/health-records/people/:personId/card',
  params: healthPersonParamsSchema,
  response: z.object({ card: healthCardSchema }),
})

/** Permissions as createHealthEvent. */
export const saveHealthCard = defineEndpoint({
  method: 'PUT',
  path: '/api/v1/health-records/people/:personId/card',
  params: healthPersonParamsSchema,
  body: healthCardBodySchema,
  response: z.object({ card: healthCardSchema }),
})

// Scanning a record: Claude reads a vaccine card or a visit summary into records for a person to
// check. The file is uploaded with createDocumentUpload first, as a document's would be. Nothing is
// saved until saveHealthScan, and a scan never reads results, diagnoses, names or ID numbers.

/** HEALTH_SCAN_MAX_EVENTS in @ghar/core/health-scan. */
export const HEALTH_SCAN_MAX = 30

export const healthScanEventSchema = z.object({
  kind: healthEventKindSchema,
  /** Null when it read nothing better than the kind's name. */
  title: z.string().nullable(),
  /** Null when it couldn't read a whole date that has happened. The person fills it in. */
  occurredOn: calendarDateSchema.nullable(),
  /** The same kind, name and day is already on their history. */
  alreadyLogged: z.boolean(),
})
export type HealthScanEvent = z.infer<typeof healthScanEventSchema>

export const healthScanSuggestionSchema = z.object({
  /** What to call the file if it's kept, like "Vaccination record". */
  documentTitle: z.string().nullable(),
  /** Newest first, undated ones last. */
  events: z.array(healthScanEventSchema).max(HEALTH_SCAN_MAX),
})
export type HealthScanSuggestion = z.infer<typeof healthScanSuggestionSchema>

const scanFileSchema = z.object({
  /** Whose record it is. The scan never reads a name, so the caller says. */
  personId: z.uuid(),
  /** From createDocumentUpload, once the file is there. */
  storagePath: z.string().min(1).max(200),
})

/**
 * Suggestions only. `suggestion` is null when Claude couldn't read it or it isn't health paperwork.
 * 404 for someone the caller can't see, 403 for someone they can't log for, 400 for a HEIC photo.
 */
export const scanHealthRecord = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/scan',
  body: scanFileSchema,
  response: z.object({ suggestion: healthScanSuggestionSchema.nullable() }),
})

export const healthScanSaveBodySchema = scanFileSchema.extend({
  /** The records the person checked, each with a date. */
  events: z
    .array(
      z.object({
        kind: healthEventKindSchema,
        title: z.string().trim().max(HEALTH_TITLE_MAX).nullable().default(null),
        occurredOn: calendarDateSchema,
      })
    )
    .min(1, 'Pick at least one record to save.')
    .max(HEALTH_SCAN_MAX),
  /**
   * Keeps the file as a medical document with this title, and links every record to it. It's
   * sensitive when the caller may mark it so. Null lets the file go once the records are saved.
   */
  keepAs: z
    .object({ title: z.string().trim().min(1).max(200) })
    .nullable()
    .default(null),
})
export type HealthScanSaveBody = z.output<typeof healthScanSaveBodySchema>

/** Saves all the records or none of them. Permissions as createHealthEvent. */
export const saveHealthScan = defineEndpoint({
  method: 'POST',
  path: '/api/v1/health-records/scan/save',
  body: healthScanSaveBodySchema,
  response: z.object({ events: z.array(healthEventSchema), documentId: z.uuid().nullable() }),
})
