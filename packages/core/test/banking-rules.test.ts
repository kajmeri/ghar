import { describe, expect, it } from 'vitest'
import {
  accountGroup,
  assertCanCreateBankItem,
  assertCanDisconnectBankItem,
  bankItemAttention,
  bankItemStateForWebhook,
  bankItemStatusForError,
  canReconnectBankItem,
  centsFromPlaidAmount,
  centsFromPlaidBalance,
  isTransferTransaction,
  PLAID_PRODUCTION_ITEM_LIMIT,
  shouldSyncBankItem,
  type BankItemState,
} from '../src/banking'
import { ConflictError, ValidationError } from '../src/errors'

const now = new Date('2026-09-13T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const good: BankItemState = { status: 'good', errorCode: null, consentExpiresAt: null }

describe('assertCanCreateBankItem', () => {
  it('allows production connections up to the limit', () => {
    expect(() => {
      assertCanCreateBankItem({
        environment: 'production',
        productionItemsCreated: PLAID_PRODUCTION_ITEM_LIMIT - 1,
      })
    }).not.toThrow()
  })

  it('refuses the connection that would pass the limit', () => {
    expect(() => {
      assertCanCreateBankItem({
        environment: 'production',
        productionItemsCreated: PLAID_PRODUCTION_ITEM_LIMIT,
      })
    }).toThrow(ConflictError)
  })

  it('never limits sandbox or fake connections', () => {
    for (const environment of ['sandbox', 'fake'] as const) {
      expect(() => {
        assertCanCreateBankItem({ environment, productionItemsCreated: 500 })
      }).not.toThrow()
    }
  })
})

describe('bank item status', () => {
  it('asks for a sign-in on login errors and marks everything else as an error', () => {
    expect(bankItemStatusForError('ITEM_LOGIN_REQUIRED')).toBe('login_required')
    expect(bankItemStatusForError('PENDING_EXPIRATION')).toBe('login_required')
    expect(bankItemStatusForError('INSTITUTION_DOWN')).toBe('error')
    expect(bankItemStatusForError('USER_PERMISSION_REVOKED')).toBe('error')
  })

  it('marks the item on ITEM_LOGIN_REQUIRED and clears it on LOGIN_REPAIRED', () => {
    const broken = bankItemStateForWebhook({ kind: 'item_error', plaidItemId: 'item', errorCode: 'ITEM_LOGIN_REQUIRED' }, good, now)
    expect(broken).toEqual({
      status: 'login_required',
      errorCode: 'ITEM_LOGIN_REQUIRED',
      consentExpiresAt: null,
    })
    expect(broken && bankItemStateForWebhook({ kind: 'login_repaired', plaidItemId: 'item' }, broken, now)).toEqual(good)
  })

  it('records when consent expires without breaking a working connection', () => {
    const expiresAt = new Date(now.getTime() + 5 * DAY)
    expect(bankItemStateForWebhook({ kind: 'consent_expiring', plaidItemId: 'item', expiresAt }, good, now)).toEqual({
      ...good,
      consentExpiresAt: expiresAt,
    })
    expect(
      bankItemStateForWebhook({ kind: 'consent_expiring', plaidItemId: 'item', expiresAt: null }, good, now)?.consentExpiresAt
    ).toEqual(new Date(now.getTime() + 7 * DAY))
  })

  it('marks a revoked item as gone for good', () => {
    const revoked = bankItemStateForWebhook({ kind: 'permission_revoked', plaidItemId: 'item' }, good, now)
    expect(revoked).toEqual({
      status: 'error',
      errorCode: 'USER_PERMISSION_REVOKED',
      consentExpiresAt: null,
    })
    expect(revoked && bankItemAttention(revoked, now)).toBe('revoked')
    expect(revoked && canReconnectBankItem(revoked, now)).toBe(false)
    expect(revoked && shouldSyncBankItem(revoked)).toBe(false)
  })

  it('leaves the item alone for sync and unknown webhooks', () => {
    expect(bankItemStateForWebhook({ kind: 'sync_available', plaidItemId: 'item' }, good, now)).toBeNull()
    expect(
      bankItemStateForWebhook(
        {
          kind: 'ignored',
          webhookType: 'HOLDINGS',
          webhookCode: 'DEFAULT_UPDATE',
          plaidItemId: 'item',
        },
        good,
        now
      )
    ).toBeNull()
  })

  it('says what a connection needs', () => {
    expect(bankItemAttention(good, now)).toBeNull()
    expect(bankItemAttention({ ...good, status: 'login_required', errorCode: 'ITEM_LOGIN_REQUIRED' }, now)).toBe('reconnect')
    expect(bankItemAttention({ ...good, consentExpiresAt: new Date(now.getTime() + 3 * DAY) }, now)).toBe('consent_expiring')
    expect(bankItemAttention({ ...good, consentExpiresAt: new Date(now.getTime() + 60 * DAY) }, now)).toBeNull()
    expect(bankItemAttention({ ...good, status: 'error', errorCode: 'INSTITUTION_DOWN' }, now)).toBe('sync_error')
  })

  it('syncs working and temporarily failing items only', () => {
    expect(shouldSyncBankItem(good)).toBe(true)
    expect(shouldSyncBankItem({ ...good, status: 'error', errorCode: 'INSTITUTION_DOWN' })).toBe(true)
    expect(shouldSyncBankItem({ ...good, status: 'login_required', errorCode: 'ITEM_LOGIN_REQUIRED' })).toBe(false)
    expect(shouldSyncBankItem({ ...good, status: 'error', errorCode: 'ITEM_NOT_FOUND' })).toBe(false)
  })
})

describe('isTransferTransaction', () => {
  it('treats transfers and card payments as transfers', () => {
    expect(isTransferTransaction({ categoryPrimary: 'TRANSFER_OUT', categoryDetailed: null })).toBe(true)
    expect(isTransferTransaction({ categoryPrimary: 'TRANSFER_IN', categoryDetailed: null })).toBe(true)
    expect(
      isTransferTransaction({
        categoryPrimary: 'LOAN_PAYMENTS',
        categoryDetailed: 'LOAN_PAYMENTS_CREDIT_CARD_PAYMENT',
      })
    ).toBe(true)
  })

  it('does not treat spending or loan payments as transfers', () => {
    expect(
      isTransferTransaction({
        categoryPrimary: 'FOOD_AND_DRINK',
        categoryDetailed: 'FOOD_AND_DRINK_COFFEE',
      })
    ).toBe(false)
    expect(
      isTransferTransaction({
        categoryPrimary: 'LOAN_PAYMENTS',
        categoryDetailed: 'LOAN_PAYMENTS_MORTGAGE_PAYMENT',
      })
    ).toBe(false)
    expect(isTransferTransaction({ categoryPrimary: null, categoryDetailed: null })).toBe(false)
  })
})

describe('turning a connection off', () => {
  const off: BankItemState = { status: 'disconnected', errorCode: null, consentExpiresAt: null }

  it('refuses to turn off a connection that is already off', () => {
    expect(() => {
      assertCanDisconnectBankItem(good)
    }).not.toThrow()
    expect(() => {
      assertCanDisconnectBankItem(off)
    }).toThrow(ConflictError)
  })

  it('is a resting state, not a problem: nothing to do, nothing to repair, nothing to sync', () => {
    expect(bankItemAttention(off, now)).toBeNull()
    expect(canReconnectBankItem(off, now)).toBe(false)
    expect(shouldSyncBankItem(off)).toBe(false)
  })

  it('ignores whatever Plaid says about it afterwards', () => {
    for (const event of [
      { kind: 'item_error', plaidItemId: 'item', errorCode: 'ITEM_LOGIN_REQUIRED' },
      { kind: 'login_repaired', plaidItemId: 'item' },
      { kind: 'consent_expiring', plaidItemId: 'item', expiresAt: new Date(now.getTime() + DAY) },
      { kind: 'permission_revoked', plaidItemId: 'item' },
    ] as const) {
      expect(bankItemStateForWebhook(event, off, now)).toBeNull()
    }
  })
})

describe('centsFromPlaidBalance', () => {
  it('keeps the sign Plaid reports, so an amount owed stays positive', () => {
    expect(centsFromPlaidBalance(1234.56)).toBe(123456)
    expect(centsFromPlaidBalance(184.23)).toBe(18423)
    expect(centsFromPlaidBalance(-12.5)).toBe(-1250)
  })

  it('rounds binary noise and never returns negative zero', () => {
    expect(centsFromPlaidBalance(0.29)).toBe(29)
    expect(Object.is(centsFromPlaidBalance(-0.001), 0)).toBe(true)
  })

  it('refuses balances that are not numbers', () => {
    expect(() => centsFromPlaidBalance(Number.POSITIVE_INFINITY)).toThrow(ValidationError)
  })
})

describe('centsFromPlaidAmount', () => {
  it('flips the sign so money out is negative', () => {
    expect(centsFromPlaidAmount(12.34)).toBe(-1234)
    expect(centsFromPlaidAmount(-500)).toBe(50000)
  })

  it('rounds binary noise to the nearest cent', () => {
    expect(centsFromPlaidAmount(0.29)).toBe(-29)
    expect(centsFromPlaidAmount(1.1)).toBe(-110)
  })

  it('never returns negative zero', () => {
    expect(Object.is(centsFromPlaidAmount(0), 0)).toBe(true)
  })

  it('refuses amounts that are not numbers', () => {
    expect(() => centsFromPlaidAmount(Number.NaN)).toThrow(ValidationError)
  })
})

describe('accountGroup', () => {
  it('groups Plaid account types', () => {
    expect(accountGroup('depository')).toBe('cash')
    expect(accountGroup('credit')).toBe('credit')
    expect(accountGroup('loan')).toBe('loans')
    expect(accountGroup('investment')).toBe('investments')
    expect(accountGroup('brokerage')).toBe('investments')
    expect(accountGroup('other')).toBe('other')
    expect(accountGroup('something new')).toBe('other')
  })
})
