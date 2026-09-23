import { DIGEST_SECTIONS } from '@ghar/core/digest'
import { describe, expect, it } from 'vitest'
import { digestPreferencesSchema, digestSectionSchema } from '../src/v1/digest'

describe('digest contracts', () => {
  it('mirrors the sections in core', () => {
    expect(digestSectionSchema.options).toEqual([...DIGEST_SECTIONS])
  })

  it('takes an hour of the day and nothing else', () => {
    const preferences = { enabled: true, sections: ['bills'], sendHour: 7 }
    expect(digestPreferencesSchema.parse(preferences)).toEqual(preferences)
    expect(digestPreferencesSchema.safeParse({ ...preferences, sendHour: 24 }).success).toBe(false)
    expect(digestPreferencesSchema.safeParse({ ...preferences, sendHour: 6.5 }).success).toBe(false)
    expect(digestPreferencesSchema.safeParse({ ...preferences, sections: ['everything'] }).success).toBe(false)
  })
})
