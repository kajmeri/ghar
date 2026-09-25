import { HEALTH_EVENT_KINDS, HEALTH_NOTE_MAX_LENGTH, HEALTH_TITLE_MAX_LENGTH } from '@ghar/core/health'
import { describe, expect, it } from 'vitest'
import { HEALTH_NOTE_MAX, HEALTH_TITLE_MAX, healthEventBodySchema, healthEventKindSchema } from '../src/v1/health-records'

describe('health records', () => {
  it('match @ghar/core', () => {
    expect(healthEventKindSchema.options).toEqual([...HEALTH_EVENT_KINDS])
    expect([HEALTH_TITLE_MAX, HEALTH_NOTE_MAX]).toEqual([HEALTH_TITLE_MAX_LENGTH, HEALTH_NOTE_MAX_LENGTH])
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
})
