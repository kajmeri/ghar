import {
  CATEGORY_COLOR_TOKENS,
  CATEGORY_ICONS,
  CATEGORY_MATCHER_TYPES,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_SOURCES,
  MATCHER_VALUE_MAX_LENGTH,
} from '@ghar/core/finances'
import { describe, expect, it } from 'vitest'
import {
  categoryColorTokenSchema,
  categoryIconSchema,
  categoryMatcherTypeSchema,
  categorySourceSchema,
  createCategory,
  saveCategoryRule,
} from '../src/v1/finances'

describe('finances contracts', () => {
  it('mirrors the lists in core', () => {
    expect(categoryIconSchema.options).toEqual([...CATEGORY_ICONS])
    expect(categoryColorTokenSchema.options).toEqual([...CATEGORY_COLOR_TOKENS])
    expect(categoryMatcherTypeSchema.options).toEqual([...CATEGORY_MATCHER_TYPES])
    expect(categorySourceSchema.options).toEqual([...CATEGORY_SOURCES])
  })

  it('holds a category name and a matcher to the same lengths core does', () => {
    const name = 'x'.repeat(CATEGORY_NAME_MAX_LENGTH)
    const category = { name, kind: 'expense', icon: 'tag' }
    expect(createCategory.body?.safeParse(category).success).toBe(true)
    expect(createCategory.body?.safeParse({ ...category, name: `${name}x` }).success).toBe(false)

    const rule = { matcherType: 'merchant_contains', categoryId: '3f6f1f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f' }
    expect(saveCategoryRule.body?.safeParse({ ...rule, matcherValue: 'x'.repeat(MATCHER_VALUE_MAX_LENGTH) }).success).toBe(true)
    expect(saveCategoryRule.body?.safeParse({ ...rule, matcherValue: 'x'.repeat(MATCHER_VALUE_MAX_LENGTH + 1) }).success).toBe(false)
  })

  it('takes a category with only what a form asks for, and refuses an icon it has never heard of', () => {
    const parsed = createCategory.body?.parse({ name: '  Coffee ', kind: 'expense', icon: 'coffee' })
    expect(parsed).toEqual({ name: 'Coffee', kind: 'expense', parentId: null, icon: 'coffee', colorToken: 'ink-muted' })
    expect(createCategory.body?.safeParse({ name: 'Coffee', kind: 'expense', icon: 'espresso-machine' }).success).toBe(false)
  })
})
