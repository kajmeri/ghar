import { describe, expect, it } from 'vitest'
import { ValidationError } from '../src/errors'
import { byAssignee, byCategory, draftsFromTemplate, packingProgress, templateDraftsFromItems, type PackingItemLike } from '../src/packing'

const packingItem = (id: string, label: string, extra: Partial<PackingItemLike> = {}): PackingItemLike => ({
  id,
  label,
  assignedUserId: null,
  isPacked: false,
  category: null,
  sortOrder: 0,
  ...extra,
})

describe('packingProgress', () => {
  it('counts what is packed and what is left', () => {
    expect(
      packingProgress([packingItem('1', 'Passport', { isPacked: true }), packingItem('2', 'Adapter'), packingItem('3', 'Sunscreen')])
    ).toEqual({ packed: 1, total: 3, remaining: 2, ratio: 1 / 3 })
  })

  it('calls an empty list zero, not done', () => {
    expect(packingProgress([])).toEqual({ packed: 0, total: 0, remaining: 0, ratio: 0 })
  })
})

describe('byAssignee', () => {
  const items = [
    packingItem('1', 'Passport', { assignedUserId: 'ana', sortOrder: 1 }),
    packingItem('2', 'Adapter', { sortOrder: 2 }),
    packingItem('3', 'Sunscreen', { assignedUserId: 'ana', isPacked: true, sortOrder: 3 }),
    packingItem('4', 'Swimsuit', { assignedUserId: 'ben', sortOrder: 4 }),
  ]

  it('groups by person and puts the unassigned pile last', () => {
    expect(byAssignee(items).map(group => group.key)).toEqual(['ana', 'ben', null])
  })

  it('reports progress per person', () => {
    expect(byAssignee(items)[0]?.progress).toMatchObject({ packed: 1, total: 2 })
  })
})

describe('byCategory', () => {
  it('groups by category and puts uncategorised last', () => {
    const groups = byCategory([
      packingItem('1', 'Passport', { category: 'Documents', sortOrder: 1 }),
      packingItem('2', 'Adapter', { sortOrder: 2 }),
      packingItem('3', 'Visa', { category: 'Documents', sortOrder: 3 }),
    ])
    expect(groups.map(group => group.key)).toEqual(['Documents', null])
    expect(groups[0]?.items).toHaveLength(2)
  })
})

describe('draftsFromTemplate', () => {
  const template = [
    { label: 'Passport', category: 'Documents', sortOrder: 1 },
    { label: 'Adapter', category: null, sortOrder: 2 },
    { label: '  ', category: null, sortOrder: 3 },
  ]

  it('adds everything to an empty list', () => {
    expect(draftsFromTemplate(template, []).map(draft => draft.label)).toEqual(['Passport', 'Adapter'])
  })

  it('skips what the list already has, whatever the casing', () => {
    const existing = [packingItem('1', 'passport', { category: 'documents', sortOrder: 4 })]
    expect(draftsFromTemplate(template, existing).map(draft => draft.label)).toEqual(['Adapter'])
  })

  it('treats the same label in a different category as a different item', () => {
    const existing = [packingItem('1', 'Passport', { category: 'Bag', sortOrder: 4 })]
    expect(draftsFromTemplate(template, existing)).toHaveLength(2)
  })

  it('adds new items after what is already on the list', () => {
    const existing = [packingItem('1', 'Toothbrush', { sortOrder: 40 })]
    expect(draftsFromTemplate(template, existing).map(draft => draft.sortOrder)).toEqual([41, 42])
  })

  it('drops blank labels', () => {
    expect(draftsFromTemplate(template, [])).toHaveLength(2)
  })
})

describe('templateDraftsFromItems', () => {
  it('keeps labels and categories, and drops packed state and assignment', () => {
    const drafts = templateDraftsFromItems([
      packingItem('1', 'Passport', {
        category: 'Documents',
        isPacked: true,
        assignedUserId: 'ana',
        sortOrder: 1,
      }),
      packingItem('2', 'Adapter', { sortOrder: 2 }),
    ])
    expect(drafts).toEqual([
      { label: 'Passport', category: 'Documents', sortOrder: 10 },
      { label: 'Adapter', category: null, sortOrder: 20 },
    ])
  })

  it('collapses duplicates', () => {
    expect(
      templateDraftsFromItems([packingItem('1', 'Passport', { sortOrder: 1 }), packingItem('2', 'passport ', { sortOrder: 2 })])
    ).toHaveLength(1)
  })

  it('refuses to save an empty list as a template', () => {
    expect(() => templateDraftsFromItems([])).toThrow(ValidationError)
    expect(() => templateDraftsFromItems([packingItem('1', '   ')])).toThrow(ValidationError)
  })
})
