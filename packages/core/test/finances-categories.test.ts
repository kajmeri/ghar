import { describe, expect, it } from 'vitest'
import { ConflictError, ValidationError } from '../src/errors'
import {
  CATEGORY_COLOR_TOKENS,
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX_LENGTH,
  DEFAULT_CATEGORIES,
  MAPPED_PFC_DETAILED_CODES,
  assertBudgetableCategory,
  assertCanRestoreCategory,
  assertCategoryParent,
  isCategoryColorToken,
  isCategoryIcon,
  normalizeCategoryName,
  pfcCategoryKey,
  type CategoryNode,
} from '../src/finances'

function fieldOf(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error
    const { fieldErrors } = error.details as { fieldErrors?: Record<string, string[]> }
    return Object.keys(fieldErrors ?? {})[0]
  }
  return undefined
}

describe('category tree rules', () => {
  const food: CategoryNode = { name: 'Food', parentId: null, kind: 'expense', isArchived: false }

  it('tidies names and keeps them to the column width', () => {
    expect(normalizeCategoryName('  Eating   out ')).toBe('Eating out')
    expect(fieldOf(() => normalizeCategoryName('   '))).toBe('name')
    expect(fieldOf(() => normalizeCategoryName('x'.repeat(CATEGORY_NAME_MAX_LENGTH + 1)))).toBe('name')
    expect(normalizeCategoryName('x'.repeat(CATEGORY_NAME_MAX_LENGTH))).toHaveLength(CATEGORY_NAME_MAX_LENGTH)
  })

  it('recognizes only the allowed icons and color tokens', () => {
    for (const icon of CATEGORY_ICONS) expect(isCategoryIcon(icon)).toBe(true)
    for (const token of CATEGORY_COLOR_TOKENS) expect(isCategoryColorToken(token)).toBe(true)
    expect(isCategoryIcon('not-an-icon')).toBe(false)
    expect(isCategoryColorToken('paper')).toBe(false)
  })

  it('allows a top-level category, or a child of a live top-level one of the same kind', () => {
    expect(() => {
      assertCategoryParent({ kind: 'income', parent: null })
    }).not.toThrow()
    expect(() => {
      assertCategoryParent({ kind: 'expense', parent: food })
    }).not.toThrow()
  })

  it('keeps the tree two levels deep, same-kind and off archived parents', () => {
    const child = { ...food, name: 'Coffee', parentId: 'food-id' }
    expect(
      fieldOf(() => {
        assertCategoryParent({ kind: 'expense', parent: child })
      })
    ).toBe('parentId')
    expect(
      fieldOf(() => {
        assertCategoryParent({ kind: 'income', parent: food })
      })
    ).toBe('parentId')
    const archived = { ...food, isArchived: true }
    expect(
      fieldOf(() => {
        assertCategoryParent({ kind: 'expense', parent: archived })
      })
    ).toBe('parentId')
  })

  it('restores a child only under a parent that is in use', () => {
    expect(() => {
      assertCanRestoreCategory(null)
    }).not.toThrow()
    expect(() => {
      assertCanRestoreCategory(food)
    }).not.toThrow()
    expect(() => {
      assertCanRestoreCategory({ ...food, isArchived: true })
    }).toThrow(ConflictError)
  })

  it('budgets live expense categories only', () => {
    expect(() => {
      assertBudgetableCategory(food)
    }).not.toThrow()
    expect(
      fieldOf(() => {
        assertBudgetableCategory({ ...food, kind: 'income' })
      })
    ).toBe('categoryId')
    expect(
      fieldOf(() => {
        assertBudgetableCategory({ ...food, kind: 'transfer' })
      })
    ).toBe('categoryId')
    expect(
      fieldOf(() => {
        assertBudgetableCategory({ ...food, isArchived: true })
      })
    ).toBe('categoryId')
  })
})

describe('default categories', () => {
  it('has unique keys and names, case-insensitively', () => {
    const keys = DEFAULT_CATEGORIES.map(category => category.key)
    const names = DEFAULT_CATEGORIES.map(category => category.name.toLowerCase())
    expect(new Set(keys).size).toBe(keys.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('is two levels deep, with parents listed before their children', () => {
    const seen = new Map<string, (typeof DEFAULT_CATEGORIES)[number]>()
    for (const category of DEFAULT_CATEGORIES) {
      if (category.parentKey !== null) {
        const parent = seen.get(category.parentKey)
        expect(parent, category.key).toBeDefined()
        expect(parent?.parentKey).toBeNull()
        expect(parent?.kind).toBe(category.kind)
      }
      seen.set(category.key, category)
    }
  })

  it('uses only allowed icons and color tokens, with names that fit the column', () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(CATEGORY_ICONS).toContain(category.icon)
      expect(CATEGORY_COLOR_TOKENS).toContain(category.colorToken)
      expect(category.name.length).toBeGreaterThan(0)
      expect(category.name.length).toBeLessThanOrEqual(40)
      expect(category.name[0]).toBe(category.name[0]?.toUpperCase())
    }
  })

  it('colors income positive and leaves everything else muted', () => {
    for (const category of DEFAULT_CATEGORIES) {
      expect(category.colorToken).toBe(category.kind === 'income' ? 'positive' : 'ink-muted')
    }
  })

  it('includes each kind of category', () => {
    const kinds = new Set(DEFAULT_CATEGORIES.map(category => category.kind))
    expect(kinds).toEqual(new Set(['expense', 'income', 'transfer']))
  })
})

describe('Plaid category map', () => {
  const keys = new Set<string>(DEFAULT_CATEGORIES.map(category => category.key))

  it('points every code at a default category', () => {
    for (const code of MAPPED_PFC_DETAILED_CODES) {
      const key = pfcCategoryKey({
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: code,
        plaidCategoryConfidence: null,
      })
      expect(key, code).not.toBeNull()
      expect(keys.has(key ?? ''), code).toBe(true)
    }
  })

  it('maps money moving between accounts to transfer categories and pay to income', () => {
    const kindOf = (detailed: string) => {
      const key = pfcCategoryKey({
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: detailed,
        plaidCategoryConfidence: 'HIGH',
      })
      return DEFAULT_CATEGORIES.find(category => category.key === key)?.kind
    }
    for (const code of MAPPED_PFC_DETAILED_CODES) {
      if (code.startsWith('TRANSFER_')) expect(kindOf(code), code).toBe('transfer')
      if (code.startsWith('INCOME_')) expect(kindOf(code), code).toBe('income')
    }
    expect(kindOf('LOAN_PAYMENTS_CREDIT_CARD_PAYMENT')).toBe('transfer')
    expect(kindOf('LOAN_PAYMENTS_MORTGAGE_PAYMENT')).toBe('expense')
  })

  it('prefers the detailed code and falls back to the primary one', () => {
    expect(
      pfcCategoryKey({
        plaidCategoryPrimary: 'FOOD_AND_DRINK',
        plaidCategoryDetailed: 'FOOD_AND_DRINK_COFFEE',
        plaidCategoryConfidence: 'VERY_HIGH',
      })
    ).toBe('coffee')
    expect(
      pfcCategoryKey({
        plaidCategoryPrimary: 'FOOD_AND_DRINK',
        plaidCategoryDetailed: 'FOOD_AND_DRINK_SOMETHING_NEW',
        plaidCategoryConfidence: 'HIGH',
      })
    ).toBe('food')
  })

  it('trusts high confidence or none, and passes on anything lower', () => {
    const at = (plaidCategoryConfidence: string | null) =>
      pfcCategoryKey({
        plaidCategoryPrimary: 'TRAVEL',
        plaidCategoryDetailed: 'TRAVEL_FLIGHTS',
        plaidCategoryConfidence,
      })
    expect(at('VERY_HIGH')).toBe('flights')
    expect(at('HIGH')).toBe('flights')
    expect(at(null)).toBe('flights')
    expect(at('MEDIUM')).toBeNull()
    expect(at('LOW')).toBeNull()
    expect(at('UNKNOWN')).toBeNull()
  })

  it('returns null for unknown codes, including ones named like object properties', () => {
    for (const code of ['constructor', '__proto__', 'toString', 'NOT_A_CATEGORY']) {
      expect(
        pfcCategoryKey({
          plaidCategoryPrimary: code,
          plaidCategoryDetailed: code,
          plaidCategoryConfidence: null,
        })
      ).toBeNull()
    }
    expect(
      pfcCategoryKey({
        plaidCategoryPrimary: null,
        plaidCategoryDetailed: null,
        plaidCategoryConfidence: null,
      })
    ).toBeNull()
  })
})
