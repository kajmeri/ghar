import { describe, expect, it } from 'vitest'
import { NOT_A_DOCUMENT, suggestionFromScan, suggestionIsEmpty, withoutIdentifiers, type DocumentScan } from '../src/document-scan'

const PASSPORT: DocumentScan = {
  isDocument: true,
  kind: 'passport',
  title: 'Passport',
  issuer: 'United States of America',
  issuedOn: '2021-03-04',
  expiresOn: '2031-03-03',
}

describe('document scans', () => {
  it('suggests what the scan read', () => {
    expect(suggestionFromScan(PASSPORT)).toEqual({
      kind: 'passport',
      title: 'Passport',
      issuer: 'United States of America',
      issuedOn: '2021-03-04',
      expiresOn: '2031-03-03',
    })
  })

  it('suggests nothing for something that isn’t a document', () => {
    expect(suggestionFromScan(NOT_A_DOCUMENT)).toBeNull()
    expect(suggestionFromScan({ ...PASSPORT, isDocument: false })).toBeNull()
  })

  it('drops a date that isn’t one, or couldn’t be on a document', () => {
    const suggestion = suggestionFromScan({ ...PASSPORT, issuedOn: '03/04/2021', expiresOn: '2031-02-30' })
    expect(suggestion).toMatchObject({ issuedOn: null, expiresOn: null })
    expect(suggestionFromScan({ ...PASSPORT, issuedOn: '1850-01-01', expiresOn: '2231-01-01' })).toMatchObject({
      issuedOn: null,
      expiresOn: null,
    })
    expect(suggestionFromScan({ ...PASSPORT, expiresOn: ' 2031-03-03 ' })?.expiresOn).toBe('2031-03-03')
  })

  it('keeps the expiry when the issue date comes after it', () => {
    expect(suggestionFromScan({ ...PASSPORT, issuedOn: '2032-01-01' })).toMatchObject({ issuedOn: null, expiresOn: '2031-03-03' })
  })

  it('never passes on a number that could identify someone', () => {
    const suggestion = suggestionFromScan({
      ...PASSPORT,
      title: 'Passport 548201937',
      issuer: 'P<USASMITH<<JANE<<<<<<<',
    })
    expect(suggestion).toMatchObject({ title: 'Passport', issuer: null })
    expect(withoutIdentifiers('Policy HO-2231-88104 renewal')).toBe('Policy renewal')
    expect(withoutIdentifiers('Member ID: A1234567')).toBe('Member ID')
  })

  it('keeps years and form numbers', () => {
    expect(withoutIdentifiers('2025 Form 1040')).toBe('2025 Form 1040')
    expect(withoutIdentifiers('W-2 for 2025')).toBe('W-2 for 2025')
  })

  it('knows when a scan found nothing', () => {
    const empty = suggestionFromScan({ ...NOT_A_DOCUMENT, isDocument: true })
    expect(empty && suggestionIsEmpty(empty)).toBe(true)
    const passport = suggestionFromScan(PASSPORT)
    expect(passport && suggestionIsEmpty(passport)).toBe(false)
  })
})
