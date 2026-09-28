import type { ExpiryRow, RenewalWithLinksRow } from '@ghar/db/queries'
import { describe, expect, it } from 'vitest'
import { toExpiry, toRenewal } from '@/lib/renewals/service'

// An automatic renewal whose date has passed has already renewed. Until the daily run moves the
// stored date on, the renewals list, the attention list and the phone still show its current term.

const today = '2026-09-28'

const lapsed: Extract<ExpiryRow, { kind: 'renewal' }> = {
  kind: 'renewal',
  id: '00000000-0000-4000-8000-000000000001',
  title: 'Costco membership',
  expiresOn: '2026-09-01',
  renewalKind: 'membership',
  autoRenews: true,
  costCents: 6500,
  cadenceMonths: 12,
  remindFromDays: null,
  notRenewing: false,
}

describe('reading an automatic renewal past its date', () => {
  it('lists it with its current term rather than as expired', () => {
    expect(toExpiry(lapsed, today)).toMatchObject({ expiresOn: '2027-09-01', state: 'current', suggestedRenewalOn: '2028-09-01' })
  })

  it('still shows as expired when it lapsed on purpose or renews by hand', () => {
    expect(toExpiry({ ...lapsed, notRenewing: true }, today)).toMatchObject({ expiresOn: '2026-09-01', state: 'expired' })
    expect(toExpiry({ ...lapsed, autoRenews: false }, today)).toMatchObject({ expiresOn: '2026-09-01', state: 'expired' })
  })

  it('shows the current term on the renewal itself', () => {
    const row: RenewalWithLinksRow = {
      id: lapsed.id,
      householdId: '00000000-0000-4000-8000-000000000002',
      title: lapsed.title,
      kind: 'membership',
      expiresOn: lapsed.expiresOn,
      remindFromDays: null,
      cadenceMonths: 12,
      autoRenews: true,
      costCents: 6500,
      provider: null,
      referenceNumber: null,
      url: null,
      contactId: null,
      contactName: null,
      assetId: null,
      assetName: null,
      documentId: null,
      documentTitle: null,
      personId: null,
      personName: null,
      personUserId: null,
      notes: null,
      notRenewing: false,
      createdAt: new Date('2025-09-01T00:00:00Z'),
      updatedAt: new Date('2025-09-01T00:00:00Z'),
    }
    expect(toRenewal(row, today, '00000000-0000-4000-8000-000000000003')).toMatchObject({
      expiresOn: '2027-09-01',
      expiryState: 'current',
    })
  })
})
