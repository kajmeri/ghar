import { describe, expect, it } from 'vitest'
import {
  HEALTH_SCAN_MAX_EVENTS,
  healthScanSchema,
  NOT_A_HEALTH_RECORD,
  suggestionFromHealthScan,
  type HealthScan,
} from '../src/health-scan'

const TODAY = '2026-09-25'

const CARD: HealthScan = {
  isHealthRecord: true,
  documentTitle: 'Vaccination record',
  events: [
    { kind: 'vaccine', title: 'MMR', occurredOn: '2019-05-02' },
    { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14' },
    { kind: 'vaccine', title: 'Tetanus booster', occurredOn: null },
  ],
}

describe('health record scans', () => {
  it('suggests each record, newest first, with undated ones last', () => {
    expect(suggestionFromHealthScan(CARD, { today: TODAY, logged: [] })).toEqual({
      documentTitle: 'Vaccination record',
      events: [
        { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14', alreadyLogged: false },
        { kind: 'vaccine', title: 'MMR', occurredOn: '2019-05-02', alreadyLogged: false },
        { kind: 'vaccine', title: 'Tetanus booster', occurredOn: null, alreadyLogged: false },
      ],
    })
  })

  it('suggests nothing for something that isn’t health paperwork', () => {
    expect(suggestionFromHealthScan(NOT_A_HEALTH_RECORD, { today: TODAY, logged: [] })).toBeNull()
  })

  it('drops dates that can’t be right, and numbers that slipped into a title', () => {
    const suggestion = suggestionFromHealthScan(
      {
        isHealthRecord: true,
        documentTitle: 'Record for 123456789',
        events: [
          { kind: 'vaccine', title: 'Flu shot lot EK5730X12', occurredOn: '2027-01-01' },
          { kind: 'checkup', title: '   ', occurredOn: '1899-12-31' },
          { kind: 'dental', title: 'Cleaning', occurredOn: '14/10/2025' },
        ],
      },
      { today: TODAY, logged: [] }
    )
    expect(suggestion).toEqual({
      documentTitle: 'Record for',
      events: [
        { kind: 'vaccine', title: 'Flu shot lot', occurredOn: null, alreadyLogged: false },
        { kind: 'checkup', title: null, occurredOn: null, alreadyLogged: false },
        { kind: 'dental', title: 'Cleaning', occurredOn: null, alreadyLogged: false },
      ],
    })
  })

  it('marks what’s already logged, matching the name without case, and drops repeats', () => {
    const suggestion = suggestionFromHealthScan(
      {
        isHealthRecord: true,
        documentTitle: null,
        events: [
          { kind: 'vaccine', title: 'flu SHOT', occurredOn: '2025-10-14' },
          { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14' },
          { kind: 'dental', title: null, occurredOn: '2025-03-01' },
          { kind: 'vaccine', title: 'MMR', occurredOn: '2025-10-14' },
        ],
      },
      {
        today: TODAY,
        logged: [
          { kind: 'vaccine', title: 'Flu shot', occurredOn: '2025-10-14' },
          // Saved without a name, so it's called by its kind.
          { kind: 'dental', title: 'Dentist', occurredOn: '2025-03-01' },
        ],
      }
    )
    expect(suggestion?.events).toEqual([
      { kind: 'vaccine', title: 'flu SHOT', occurredOn: '2025-10-14', alreadyLogged: true },
      { kind: 'vaccine', title: 'MMR', occurredOn: '2025-10-14', alreadyLogged: false },
      { kind: 'dental', title: null, occurredOn: '2025-03-01', alreadyLogged: true },
    ])
  })

  it('suggests at most the limit', () => {
    const events = Array.from({ length: HEALTH_SCAN_MAX_EVENTS + 5 }, (_, index) => ({
      kind: 'vaccine' as const,
      title: `Dose ${String(index + 1)}`,
      occurredOn: '2024-01-01',
    }))
    expect(
      suggestionFromHealthScan({ isHealthRecord: true, documentTitle: null, events }, { today: TODAY, logged: [] })?.events
    ).toHaveLength(HEALTH_SCAN_MAX_EVENTS)
  })

  it('has no field for a result, a diagnosis, a name or an ID number', () => {
    const parsed = healthScanSchema.parse({
      ...CARD,
      patientName: 'Anika Rao',
      events: [{ kind: 'test', title: 'Blood test', occurredOn: '2025-01-02', result: 'High cholesterol', lotNumber: 'EK5730' }],
    })
    expect(JSON.stringify(parsed)).not.toMatch(/Anika|cholesterol|EK5730/)
  })
})
