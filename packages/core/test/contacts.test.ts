import { describe, expect, it } from 'vitest'
import { normalizeContactTags, phoneHref, searchContacts } from '../src/contacts'
import { matchesSearch } from '../src/search'

const contacts = [
  { name: 'Rosa Diaz', role: 'Plumber', phone: '(415) 555-0142', email: null, notes: 'Fixed the dishwasher drain', tags: ['kitchen'] },
  { name: 'Dr. Patel', role: 'Pediatrician', phone: '+1 415 555 0199', email: 'office@patelpeds.example', notes: null, tags: ['kids'] },
  { name: 'Paul Kim', role: 'Insurance agent', phone: null, email: 'paul@agency.example', notes: null, tags: ['auto', 'home'] },
]

describe('searchContacts', () => {
  it('finds a contact by role, notes or tag', () => {
    expect(searchContacts(contacts, 'plumber').map(contact => contact.name)).toEqual(['Rosa Diaz'])
    expect(searchContacts(contacts, 'dishwasher').map(contact => contact.name)).toEqual(['Rosa Diaz'])
    expect(searchContacts(contacts, 'kids').map(contact => contact.name)).toEqual(['Dr. Patel'])
  })

  it('finds a phone number however it was typed', () => {
    expect(searchContacts(contacts, '4155550142').map(contact => contact.name)).toEqual(['Rosa Diaz'])
    expect(searchContacts(contacts, '555-0199').map(contact => contact.name)).toEqual(['Dr. Patel'])
  })

  it('puts names that start with the query first', () => {
    expect(searchContacts(contacts, 'pa').map(contact => contact.name)).toEqual(['Paul Kim', 'Dr. Patel'])
  })

  it('returns everyone, by name, for an empty query', () => {
    expect(searchContacts(contacts, '').map(contact => contact.name)).toEqual(['Dr. Patel', 'Paul Kim', 'Rosa Diaz'])
  })
})

describe('matchesSearch', () => {
  it('ignores accents and needs every word', () => {
    expect(matchesSearch(['José Ramírez'], 'jose')).toBe(true)
    expect(matchesSearch(['José Ramírez'], 'jose smith')).toBe(false)
  })

  it('does not match digits spread across fields', () => {
    expect(matchesSearch(['123', '456'], '3456')).toBe(false)
  })
})

describe('contact helpers', () => {
  it('tidies tags', () => {
    expect(normalizeContactTags([' Kitchen ', 'kitchen', 'Home  Repair', ''])).toEqual(['kitchen', 'home repair'])
  })

  it('makes a dialable link', () => {
    expect(phoneHref('(415) 555-0142')).toBe('tel:4155550142')
    expect(phoneHref('+1 415 555 0199')).toBe('tel:+14155550199')
    expect(phoneHref('ext')).toBeNull()
  })
})
