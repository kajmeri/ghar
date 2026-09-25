import {
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
} from '../src/v1/health-records'

describe('health records', () => {
  it('match @ghar/core', () => {
    expect(healthEventKindSchema.options).toEqual([...HEALTH_EVENT_KINDS])
    expect([HEALTH_TITLE_MAX, HEALTH_NOTE_MAX]).toEqual([HEALTH_TITLE_MAX_LENGTH, HEALTH_NOTE_MAX_LENGTH])
    expect([HEALTH_CADENCE_MIN, HEALTH_CADENCE_MAX]).toEqual([HEALTH_CADENCE_MONTHS_MIN, HEALTH_CADENCE_MONTHS_MAX])
    expect([MEDICINE_NAME_MAX, MEDICINE_DOSE_MAX]).toEqual([MEDICINE_NAME_MAX_LENGTH, MEDICINE_DOSE_MAX_LENGTH])
    expect([MEDICINE_SUPPLY_DAYS_MIN, MEDICINE_SUPPLY_DAYS_MAX]).toEqual([CORE_SUPPLY_MIN, CORE_SUPPLY_MAX])
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
})
