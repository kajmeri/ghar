import { describe, expect, it } from 'vitest'
import {
  isOnPackingList,
  namesPhrase,
  packingSuggestions,
  type PackingSuggestionInput,
  type SuggestionTraveller,
} from '../src/packing-suggestions'

const TODAY = '2026-09-28'
const STARTS = '2026-12-20'

const priya: SuggestionTraveller = { id: 'p-priya', name: 'Priya', birthDate: null, userId: 'u-priya', role: 'owner' }
const dev: SuggestionTraveller = { id: 'p-dev', name: 'Dev', birthDate: null, userId: 'u-dev', role: 'adult' }
/** 18 months old on the day the trip starts. */
const mia: SuggestionTraveller = { id: 'p-mia', name: 'Mia', birthDate: '2025-06-20', userId: null, role: null }
/** 3 on the day the trip starts. */
const leo: SuggestionTraveller = { id: 'p-leo', name: 'Leo', birthDate: '2023-06-01', userId: null, role: null }
/** 6 on the day the trip starts. */
const ada: SuggestionTraveller = { id: 'p-ada', name: 'Ada', birthDate: '2020-03-01', userId: null, role: null }

const names = new Map([priya, dev, mia, leo, ada].map(person => [person.id, person.name]))

function input(extra: Partial<PackingSuggestionInput> = {}): PackingSuggestionInput {
  return {
    trip: { international: false, startsOn: STARTS },
    travellers: [priya, dev],
    grownUpPersonIds: [priya.id, dev.id],
    names,
    bookings: [],
    medicines: [],
    items: [],
    dismissedKeys: [],
    today: TODAY,
    ...extra,
  }
}

const keys = (value: PackingSuggestionInput) => packingSuggestions(value).suggestions.map(suggestion => suggestion.key)
const flight = { kind: 'flight', status: 'booked' } as const
const car = { kind: 'car', status: 'booked' } as const

describe('packingSuggestions', () => {
  it('has nothing to say about two adults driving at home', () => {
    expect(keys(input())).toEqual([])
  })

  it('asks for each traveller’s passport and an adapter on a trip abroad', () => {
    const result = packingSuggestions(input({ trip: { international: true, startsOn: STARTS } }))
    expect(result.suggestions.map(suggestion => suggestion.key)).toEqual(['passport:p-priya', 'passport:p-dev', 'plug_adapter'])
    expect(result.suggestions[0]).toMatchObject({
      label: 'Priya’s passport',
      category: 'Documents',
      personId: 'p-priya',
      reason: 'The trip goes abroad.',
    })
  })

  it('asks for a driving permit only when a car is booked abroad', () => {
    expect(keys(input({ trip: { international: true, startsOn: STARTS }, bookings: [car] }))).toContain('driving_permit')
    expect(keys(input({ bookings: [car] }))).not.toContain('driving_permit')
  })

  it('asks the adults for ID on a flight at home, but not abroad, where the passport does', () => {
    expect(keys(input({ bookings: [flight] }))).toEqual(['id:p-priya', 'id:p-dev'])
    expect(keys(input({ trip: { international: true, startsOn: STARTS }, bookings: [flight] }))).not.toContain('id:p-priya')
  })

  it('ignores a cancelled booking', () => {
    expect(keys(input({ bookings: [{ kind: 'flight', status: 'cancelled' }] }))).toEqual([])
  })

  it('suggests the baby things for a child under 2, and proof of age on a flight', () => {
    const result = packingSuggestions(input({ travellers: [priya, mia], bookings: [flight] }))
    expect(result.suggestions.map(suggestion => suggestion.key)).toEqual([
      'id:p-priya',
      'proof_of_age:p-mia',
      'stroller',
      'diapers',
      'baby_food',
    ])
    expect(result.suggestions.find(suggestion => suggestion.kind === 'stroller')?.reason).toBe('Mia will be 18 months old.')
  })

  it('adds a car seat for a baby when the family will drive', () => {
    expect(keys(input({ travellers: [priya, mia] }))).toContain('car_seat:p-mia')
    expect(keys(input({ travellers: [priya, mia], bookings: [flight] }))).not.toContain('car_seat:p-mia')
    expect(keys(input({ travellers: [priya, mia], bookings: [flight, car] }))).toContain('car_seat:p-mia')
  })

  it('gives a 3-year-old a car seat and a 6-year-old a booster when driving', () => {
    const result = packingSuggestions(input({ travellers: [priya, leo, ada], bookings: [car] }))
    expect(result.suggestions.map(suggestion => suggestion.key)).toEqual(['car_seat:p-leo', 'booster_seat:p-ada'])
    expect(result.suggestions[0]?.reason).toBe('There’s a car booked, and Leo will be 3 years old.')
  })

  it('works out age on the day the trip starts, not today', () => {
    // Leo turns 4 on Jun 1, 2027: a car seat for a trip before, a booster for one after.
    expect(keys(input({ travellers: [leo], trip: { international: false, startsOn: '2027-05-31' } }))).toEqual(['car_seat:p-leo'])
    expect(keys(input({ travellers: [leo], trip: { international: false, startsOn: '2027-06-01' } }))).toEqual(['booster_seat:p-leo'])
  })

  it('uses today for a trip with no dates yet', () => {
    const result = packingSuggestions(input({ travellers: [mia], trip: { international: false, startsOn: null } }))
    expect(result.suggestions.find(suggestion => suggestion.kind === 'stroller')?.reason).toBe('Mia is 15 months old.')
  })

  it('names every child under 2 in one stroller suggestion', () => {
    const twin = { ...mia, id: 'p-sam', name: 'Sam' }
    const result = packingSuggestions(input({ travellers: [mia, twin], bookings: [flight] }))
    expect(result.suggestions.filter(suggestion => suggestion.kind === 'stroller')).toHaveLength(1)
    expect(result.suggestions.find(suggestion => suggestion.kind === 'stroller')?.reason).toBe('Mia and Sam will be under 2.')
  })

  it('asks for a consent letter when a child goes abroad without one of the grown-ups', () => {
    const abroad = { trip: { international: true, startsOn: STARTS } }
    const result = packingSuggestions(input({ ...abroad, travellers: [priya, ada] }))
    expect(result.suggestions.find(suggestion => suggestion.kind === 'consent_letter')).toMatchObject({
      key: 'consent_letter:p-ada',
      label: 'Consent letter for Ada',
      reason: 'Ada is going abroad without Dev. Some borders ask for a signed letter from a parent who isn’t there.',
    })
    expect(keys(input({ ...abroad, travellers: [priya, dev, ada] }))).not.toContain('consent_letter:p-ada')
  })

  it('lists each current medicine of each traveller, and only theirs', () => {
    const result = packingSuggestions(
      input({
        medicines: [
          { id: 'm1', personId: priya.id, name: 'Levothyroxine' },
          { id: 'm2', personId: 'p-home', name: 'Insulin' },
        ],
      })
    )
    expect(result.suggestions).toEqual([
      {
        key: 'medicine:m1',
        kind: 'medicine',
        label: 'Priya’s Levothyroxine',
        category: 'Medicines',
        reason: 'Priya is taking it now.',
        personId: 'p-priya',
      },
    ])
  })

  it('leaves out what is on the list, by key or by the same label', () => {
    const abroad = input({ trip: { international: true, startsOn: STARTS } })
    expect(
      keys({
        ...abroad,
        items: [
          { label: 'Mum’s passport', suggestionKey: 'passport:p-priya' },
          { label: '  plug ADAPTER ', suggestionKey: null },
        ],
      })
    ).toEqual(['passport:p-dev'])
  })

  it('counts what was dismissed instead of showing it', () => {
    const result = packingSuggestions({
      ...input({ trip: { international: true, startsOn: STARTS } }),
      dismissedKeys: ['plug_adapter', 'stroller'],
    })
    expect(result.suggestions.map(suggestion => suggestion.key)).toEqual(['passport:p-priya', 'passport:p-dev'])
    // The stroller doesn't apply to this trip, so it isn't counted.
    expect(result.dismissedCount).toBe(1)
  })

  it('points out travellers who could be children but have no birth date', () => {
    const kid = { ...mia, birthDate: null }
    const teen = { id: 'p-teen', name: 'Rohan', birthDate: null, userId: 'u-teen', role: 'member' } as const
    expect(packingSuggestions(input({ travellers: [priya, kid, teen] })).unknownAgeTravellerIds).toEqual(['p-mia', 'p-teen'])
  })

  it('counts a grown-up by birth date before role', () => {
    const young = { ...dev, birthDate: '2010-01-01' }
    expect(keys(input({ travellers: [young], bookings: [flight] }))).toEqual([])
  })
})

describe('isOnPackingList', () => {
  it('matches by key, or by a label typed the same way', () => {
    const suggestion = { key: 'plug_adapter', label: 'Plug adapter' }
    expect(isOnPackingList(suggestion, [{ label: 'Travel adapter', suggestionKey: 'plug_adapter' }])).toBe(true)
    expect(isOnPackingList(suggestion, [{ label: 'PLUG ADAPTER', suggestionKey: null }])).toBe(true)
    expect(isOnPackingList(suggestion, [{ label: 'Adapter', suggestionKey: null }])).toBe(false)
  })
})

describe('namesPhrase', () => {
  it('joins names the way a sentence would', () => {
    expect(namesPhrase(['Mia'])).toBe('Mia')
    expect(namesPhrase(['Mia', 'Leo'])).toBe('Mia and Leo')
    expect(namesPhrase(['Mia', 'Leo', 'Ada'])).toBe('Mia, Leo and Ada')
  })
})
