import {
  BLOOD_TYPES,
  HEALTH_CARD_ITEM_MAX_LENGTH,
  HEALTH_CARD_ITEMS_MAX as CORE_CARD_ITEMS_MAX,
  HEALTH_CARD_NOTE_MAX_LENGTH,
  HEALTH_CADENCE_MONTHS_MAX,
  HEALTH_CADENCE_MONTHS_MIN,
  HEALTH_EVENT_KINDS,
  HEALTH_NOTE_MAX_LENGTH,
  HEALTH_TITLE_MAX_LENGTH,
  MEDICINE_DOSE_MAX_LENGTH,
  MEDICINE_NAME_MAX_LENGTH,
  MEDICINE_SUPPLY_DAYS_MAX as CORE_SUPPLY_MAX,
  MEDICINE_SUPPLY_DAYS_MIN as CORE_SUPPLY_MIN,
} from '@ghar/core/health'
import { HEALTH_SCAN_MAX_EVENTS } from '@ghar/core/health-scan'
import { describe, expect, it } from 'vitest'
import {
  HEALTH_CADENCE_MAX,
  HEALTH_CADENCE_MIN,
  HEALTH_NOTE_MAX,
  HEALTH_TITLE_MAX,
  MEDICINE_DOSE_MAX,
  MEDICINE_NAME_MAX,
  MEDICINE_SUPPLY_DAYS_MAX,
  MEDICINE_SUPPLY_DAYS_MIN,
  healthEventBodySchema,
  healthMedicineBodySchema,
  healthEventKindSchema,
  bloodTypeSchema,
  healthCardBodySchema,
  HEALTH_CARD_ITEM_MAX,
  HEALTH_CARD_ITEMS_MAX,
  HEALTH_CARD_NOTE_MAX,
  HEALTH_SCAN_MAX,
  healthScanSaveBodySchema,
} from '../src/v1/health-records'

describe('health records', () => {
  it('match @ghar/core', () => {
    expect(healthEventKindSchema.options).toEqual([...HEALTH_EVENT_KINDS])
    expect([HEALTH_TITLE_MAX, HEALTH_NOTE_MAX]).toEqual([HEALTH_TITLE_MAX_LENGTH, HEALTH_NOTE_MAX_LENGTH])
    expect([HEALTH_CADENCE_MIN, HEALTH_CADENCE_MAX]).toEqual([HEALTH_CADENCE_MONTHS_MIN, HEALTH_CADENCE_MONTHS_MAX])
    expect([MEDICINE_NAME_MAX, MEDICINE_DOSE_MAX]).toEqual([MEDICINE_NAME_MAX_LENGTH, MEDICINE_DOSE_MAX_LENGTH])
    expect([MEDICINE_SUPPLY_DAYS_MIN, MEDICINE_SUPPLY_DAYS_MAX]).toEqual([CORE_SUPPLY_MIN, CORE_SUPPLY_MAX])
    expect(bloodTypeSchema.options).toEqual([...BLOOD_TYPES])
    expect([HEALTH_CARD_ITEM_MAX, HEALTH_CARD_ITEMS_MAX, HEALTH_CARD_NOTE_MAX]).toEqual([
      HEALTH_CARD_ITEM_MAX_LENGTH,
      CORE_CARD_ITEMS_MAX,
      HEALTH_CARD_NOTE_MAX_LENGTH,
    ])
    expect(HEALTH_SCAN_MAX).toBe(HEALTH_SCAN_MAX_EVENTS)
  })

  it('need only whose, what kind and when', () => {
    const personId = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    expect(healthEventBodySchema.parse({ personId, kind: 'dental', occurredOn: '2026-09-01' })).toEqual({
      personId,
      kind: 'dental',
      title: null,
      occurredOn: '2026-09-01',
      contactId: null,
      documentId: null,
      note: null,
    })
    expect(healthEventBodySchema.safeParse({ personId, kind: 'surgery', occurredOn: '2026-09-01' }).success).toBe(false)
    expect(healthEventBodySchema.safeParse({ personId, kind: 'test', occurredOn: '2026-09-01', note: 'x'.repeat(1001) }).success).toBe(
      false
    )
  })

  it('take a medicine with only whose and its name', () => {
    const personId = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    expect(healthMedicineBodySchema.parse({ personId, name: ' Cetirizine ' })).toEqual({
      personId,
      name: 'Cetirizine',
      dose: null,
      contactId: null,
      startedOn: null,
      stoppedOn: null,
      refillBy: null,
      supplyDays: null,
      note: null,
    })
    expect(healthMedicineBodySchema.safeParse({ personId, name: '  ' }).success).toBe(false)
    expect(healthMedicineBodySchema.safeParse({ personId, name: 'X', supplyDays: 0 }).success).toBe(false)
  })

  it('take a blank card as empty lists and nulls', () => {
    expect(healthCardBodySchema.parse({})).toEqual({
      bloodType: null,
      allergies: [],
      conditions: [],
      doctorContactId: null,
      insuranceDocumentId: null,
      emergencyNote: null,
    })
    expect(healthCardBodySchema.safeParse({ bloodType: 'C+' }).success).toBe(false)
    expect(healthCardBodySchema.safeParse({ allergies: Array.from({ length: 21 }, () => 'x') }).success).toBe(false)
  })

  it('save a scan only with at least one dated record, and let the file go unless asked', () => {
    const personId = '6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
    const storagePath = 'household/file.pdf'
    expect(healthScanSaveBodySchema.safeParse({ personId, storagePath, events: [] }).success).toBe(false)
    expect(healthScanSaveBodySchema.safeParse({ personId, storagePath, events: [{ kind: 'vaccine', occurredOn: null }] }).success).toBe(
      false
    )
    expect(healthScanSaveBodySchema.parse({ personId, storagePath, events: [{ kind: 'vaccine', occurredOn: '2025-10-14' }] })).toEqual({
      personId,
      storagePath,
      events: [{ kind: 'vaccine', title: null, occurredOn: '2025-10-14' }],
      keepAs: null,
    })
  })
})
