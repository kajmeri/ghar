import {
  QUICK_LOG_CHOICES_MAX,
  QUICK_LOG_COST_MAX_CENTS,
  QUICK_LOG_DESCRIPTION_MAX_LENGTH,
  QUICK_LOG_ENTRIES_MAX,
  QUICK_LOG_TEXT_MAX_LENGTH,
} from '@ghar/core/quick-log'
import { describe, expect, it } from 'vitest'
import { undoRenewExpiry } from '../src/v1/renewals'
import {
  parseQuickLog,
  QUICK_LOG_CHOICES,
  QUICK_LOG_COST_MAX,
  QUICK_LOG_DESCRIPTION_MAX,
  QUICK_LOG_ENTRIES,
  QUICK_LOG_TEXT_MAX,
  quickLogApplyBodySchema,
} from '../src/v1/quick-log'

const billId = '6f0c6f4e-4b7e-4a55-9a3e-2d2f1b0c9a11'

describe('quick log', () => {
  it('matches @ghar/core', () => {
    expect(QUICK_LOG_TEXT_MAX).toBe(QUICK_LOG_TEXT_MAX_LENGTH)
    expect(QUICK_LOG_CHOICES).toBe(QUICK_LOG_CHOICES_MAX)
    expect(QUICK_LOG_COST_MAX).toBe(QUICK_LOG_COST_MAX_CENTS)
    expect(QUICK_LOG_DESCRIPTION_MAX).toBe(QUICK_LOG_DESCRIPTION_MAX_LENGTH)
    expect(QUICK_LOG_ENTRIES).toBe(QUICK_LOG_ENTRIES_MAX)
  })

  it('takes one trimmed sentence', () => {
    expect(parseQuickLog.body.parse({ text: '  paid the water bill ' })).toEqual({ text: 'paid the water bill' })
    expect(parseQuickLog.body.safeParse({ text: '   ' }).success).toBe(false)
    expect(parseQuickLog.body.safeParse({ text: 'x'.repeat(QUICK_LOG_TEXT_MAX + 1) }).success).toBe(false)
  })

  it('applies a suggestion as it came back, names and all, keeping only what records it', () => {
    expect(
      quickLogApplyBodySchema.parse({ action: 'bill_paid', billId, billName: 'Water', dueOn: '2026-09-20', paidOn: '2026-09-24' })
    ).toEqual({ action: 'bill_paid', billId, dueOn: '2026-09-20', paidOn: '2026-09-24' })
    expect(quickLogApplyBodySchema.parse({ action: 'task_done', taskId: billId, completedOn: '2026-09-24' })).toMatchObject({
      costCents: null,
    })
    expect(
      quickLogApplyBodySchema.safeParse({ action: 'task_done', taskId: billId, completedOn: '2026-09-24', costCents: -5 }).success
    ).toBe(false)
    expect(
      quickLogApplyBodySchema.parse({
        action: 'health_event',
        personId: billId,
        personName: 'You',
        kind: 'vaccine',
        title: ' Flu shot ',
        occurredOn: '2026-09-24',
      })
    ).toEqual({ action: 'health_event', personId: billId, kind: 'vaccine', title: 'Flu shot', occurredOn: '2026-09-24' })
    expect(
      quickLogApplyBodySchema.safeParse({
        action: 'health_event',
        personId: billId,
        kind: 'vaccine',
        title: 'x'.repeat(121),
        occurredOn: '2026-09-24',
      }).success
    ).toBe(false)
    expect(
      quickLogApplyBodySchema.parse({
        action: 'medicine_refilled',
        medicineId: billId,
        medicineName: 'Metformin',
        personName: 'You',
        refilledOn: '2026-09-24',
      })
    ).toEqual({ action: 'medicine_refilled', medicineId: billId, refilledOn: '2026-09-24' })
    expect(quickLogApplyBodySchema.safeParse({ action: 'paid_rent', billId }).success).toBe(false)
  })

  it('takes cash as a positive amount, and a renewal with its new date', () => {
    expect(
      quickLogApplyBodySchema.parse({
        action: 'cash_spent',
        description: ' Lunch ',
        amountCents: 1250,
        spentOn: '2026-09-24',
        categoryName: 'Restaurants',
      })
    ).toEqual({ action: 'cash_spent', description: 'Lunch', merchant: null, amountCents: 1250, spentOn: '2026-09-24', categoryId: null })
    for (const amountCents of [0, -500, 1.5]) {
      expect(
        quickLogApplyBodySchema.safeParse({ action: 'cash_spent', description: 'Lunch', amountCents, spentOn: '2026-09-24' }).success
      ).toBe(false)
    }
    expect(quickLogApplyBodySchema.safeParse({ action: 'renewed', kind: 'renewal', subjectId: billId, expiresOn: null }).success).toBe(
      false
    )
    expect(
      quickLogApplyBodySchema.parse({
        action: 'not_renewing',
        kind: 'document',
        subjectId: billId,
        name: 'Passport',
        expiresOn: '2027-01-01',
      })
    ).toEqual({ action: 'not_renewing', kind: 'document', subjectId: billId, expiresOn: '2027-01-01' })
  })

  it('undoes a renewal only back to an earlier date', () => {
    expect(undoRenewExpiry.body.parse({ renewedTo: '2027-01-01', previousExpiresOn: '2026-01-01' })).toEqual({
      renewedTo: '2027-01-01',
      previousExpiresOn: '2026-01-01',
      previousIssuedOn: null,
    })
    expect(undoRenewExpiry.body.safeParse({ renewedTo: '2027-01-01', previousExpiresOn: '2027-01-01' }).success).toBe(false)
  })
})
