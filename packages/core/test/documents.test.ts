import { describe, expect, it } from 'vitest'
import {
  canMarkDocumentSensitive,
  canSeeDocument,
  documentStoragePath,
  expiryPhrase,
  expiryState,
  fitWithin,
  isDocumentMimeType,
  needsRenewal,
  searchDocuments,
  storagePathHousehold,
} from '../src/documents'

const HOUSEHOLD = '0b7f6a4e-8a8d-4f7e-9a51-3f7a1e2b9c10'
const OBJECT = '5d1c2b3a-4e5f-4a6b-8c7d-9e0f1a2b3c4d'

describe('document search', () => {
  const documents = [
    { title: 'Car insurance', issuer: 'Geico', referenceNumber: 'POL-44817', notes: null, assetName: 'Honda CR-V' },
    { title: 'Passport', issuer: 'US State Department', referenceNumber: null, notes: 'Renew by mail', assetName: null },
    { title: 'Water heater warranty', issuer: 'Rheem', referenceNumber: null, notes: null, assetName: 'Water heater' },
  ]

  it('finds a document by policy number, issuer or the thing it covers', () => {
    expect(searchDocuments(documents, 'pol-448').map(d => d.title)).toEqual(['Car insurance'])
    expect(searchDocuments(documents, 'honda').map(d => d.title)).toEqual(['Car insurance'])
    expect(searchDocuments(documents, 'rheem warranty').map(d => d.title)).toEqual(['Water heater warranty'])
  })

  it('returns everything for an empty query', () => {
    expect(searchDocuments(documents, '  ')).toHaveLength(3)
  })
})

describe('storage paths', () => {
  it('put the household first and never use the title', () => {
    const path = documentStoragePath(HOUSEHOLD, OBJECT, 'image/jpeg')
    expect(path).toBe(`${HOUSEHOLD}/${OBJECT}.jpg`)
    expect(storagePathHousehold(path)).toBe(HOUSEHOLD)
  })

  it('reject anything Ghar would not have made', () => {
    for (const path of [
      `${HOUSEHOLD}/../${OBJECT}.jpg`,
      `${HOUSEHOLD}/${OBJECT}.exe`,
      `${HOUSEHOLD}/passport.jpg`,
      `/${HOUSEHOLD}/${OBJECT}.jpg`,
      `${HOUSEHOLD}/${OBJECT}.jpg?download`,
      `${HOUSEHOLD}/nested/${OBJECT}.pdf`,
    ]) {
      expect(storagePathHousehold(path)).toBeNull()
    }
  })

  it('accepts photos and PDFs only', () => {
    expect(isDocumentMimeType('application/pdf')).toBe(true)
    expect(isDocumentMimeType('image/heic')).toBe(true)
    expect(isDocumentMimeType('text/html')).toBe(false)
    expect(isDocumentMimeType('image/svg+xml')).toBe(false)
  })
})

describe('canSeeDocument', () => {
  const sensitive = { isSensitive: true, personUserId: 'someone-else' }

  it('keeps sensitive documents to owners and adults', () => {
    expect(canSeeDocument({ role: 'owner', userId: 'me' }, sensitive)).toBe(true)
    expect(canSeeDocument({ role: 'adult', userId: 'me' }, sensitive)).toBe(true)
    expect(canSeeDocument({ role: 'member', userId: 'me' }, sensitive)).toBe(false)
    expect(canSeeDocument({ role: 'viewer', userId: 'me' }, sensitive)).toBe(false)
    expect(canSeeDocument({ role: 'viewer', userId: 'me' }, { isSensitive: false, personUserId: null })).toBe(true)
  })

  it('lets the person a sensitive document belongs to see it', () => {
    expect(canSeeDocument({ role: 'member', userId: 'me' }, { isSensitive: true, personUserId: 'me' })).toBe(true)
    expect(canSeeDocument({ role: 'viewer', userId: 'me' }, { isSensitive: true, personUserId: 'me' })).toBe(true)
    // A job running with no account behind it is nobody's own.
    expect(canSeeDocument({ role: 'member', userId: null }, { isSensitive: true, personUserId: null })).toBe(false)
  })
})

describe('canMarkDocumentSensitive', () => {
  it('lets owners and adults mark anything, and everyone else only their own', () => {
    expect(canMarkDocumentSensitive({ role: 'adult', userId: 'me' }, { personUserId: null })).toBe(true)
    expect(canMarkDocumentSensitive({ role: 'member', userId: 'me' }, { personUserId: 'me' })).toBe(true)
    expect(canMarkDocumentSensitive({ role: 'member', userId: 'me' }, { personUserId: 'someone-else' })).toBe(false)
    expect(canMarkDocumentSensitive({ role: 'member', userId: 'me' }, { personUserId: null })).toBe(false)
  })
})

describe('expiry', () => {
  const today = '2026-09-14'

  it('names the state, expiring from its lead time', () => {
    expect(expiryState('2026-09-13', today, 60)).toBe('expired')
    expect(expiryState('2026-09-14', today, 60)).toBe('expiring')
    expect(expiryState('2026-11-13', today, 60)).toBe('expiring')
    expect(expiryState('2026-11-14', today, 60)).toBe('current')
    // A passport is expiring six months out.
    expect(expiryState('2027-03-13', today, 180)).toBe('expiring')
    expect(expiryState('2027-03-14', today, 180)).toBe('current')
  })

  it('shows on the dashboard from its lead time ahead to 30 days after', () => {
    expect(needsRenewal('2026-11-13', today, 60)).toBe(true)
    expect(needsRenewal('2026-11-14', today, 60)).toBe(false)
    expect(needsRenewal('2026-08-15', today, 60)).toBe(true)
    expect(needsRenewal('2026-08-14', today, 60)).toBe(false)
    expect(needsRenewal('2027-03-13', today, 180)).toBe(true)
    expect(needsRenewal('2026-10-01', today, 14)).toBe(false)
  })

  it('says it plainly', () => {
    expect(expiryPhrase('2026-09-14', today)).toBe('Expires today')
    expect(expiryPhrase('2026-09-15', today)).toBe('Expires tomorrow')
    expect(expiryPhrase('2026-10-14', today)).toBe('Expires in 30 days')
    expect(expiryPhrase('2026-09-13', today)).toBe('Expired yesterday')
    expect(expiryPhrase('2026-09-04', today)).toBe('Expired 10 days ago')
    expect(expiryPhrase('2027-02-24', today)).toBe('Expires in 5 months')
    expect(expiryPhrase('2027-10-22', today)).toBe('Expires in 13 months')
    expect(expiryPhrase('2030-10-26', today)).toBe('Expires in 4 years')
    expect(expiryPhrase('2026-03-01', today)).toBe('Expired 6 months ago')
  })
})

describe('fitWithin', () => {
  it('scales the longest side down to the limit', () => {
    expect(fitWithin(4032, 3024, 2000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(3024, 4032, 2000)).toEqual({ width: 1500, height: 2000 })
  })

  it('never scales up', () => {
    expect(fitWithin(1200, 800, 2000)).toEqual({ width: 1200, height: 800 })
  })
})
