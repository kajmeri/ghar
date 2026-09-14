import { describe, expect, it } from 'vitest'
import {
  amountMatches,
  billDueDates,
  billNeedsAttention,
  billScheduleProblem,
  matchBillPayments,
  normalizePayee,
  payeeMatches,
  summarizeBill,
  type BillForMatching,
  type PaymentCandidate,
} from '../src/bills'

describe('billDueDates', () => {
  it('clamps a monthly due day to short months', () => {
    expect(billDueDates({ cadence: 'monthly', dueDay: 31, dueMonth: null }, '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ])
  })

  it('keeps quarterly bills on their anchor month and every third one after', () => {
    expect(billDueDates({ cadence: 'quarterly', dueDay: 15, dueMonth: 2 }, '2026-01-01', '2026-12-31')).toEqual([
      '2026-02-15',
      '2026-05-15',
      '2026-08-15',
      '2026-11-15',
    ])
  })

  it('finds an annual bill across a year end, inside the range only', () => {
    const schedule = { cadence: 'annual', dueDay: 5, dueMonth: 1 } as const
    expect(billDueDates(schedule, '2026-12-01', '2027-02-01')).toEqual(['2027-01-05'])
    expect(billDueDates(schedule, '2027-01-06', '2027-02-01')).toEqual([])
  })

  it('explains a bad schedule', () => {
    expect(billScheduleProblem({ cadence: 'monthly', dueDay: 1, dueMonth: null })).toBeNull()
    expect(billScheduleProblem({ cadence: 'monthly', dueDay: 0, dueMonth: null })).toMatch(/due day/)
    expect(billScheduleProblem({ cadence: 'annual', dueDay: 1, dueMonth: null })).toMatch(/month/)
    expect(billScheduleProblem({ cadence: 'quarterly', dueDay: 1, dueMonth: 13 })).toMatch(/month/)
  })
})

describe('payee matching', () => {
  it('strips the noise bank descriptions add', () => {
    expect(normalizePayee('PG&E WEB ONLINE 0921')).toBe('pg and e')
    expect(normalizePayee('Comcast Cable Comm. Payment')).toBe('comcast cable comm')
  })

  it('finds the payee inside a description, spacing aside', () => {
    expect(payeeMatches('Comcast', 'COMCAST CABLE COMM PAYMENT')).toBe(true)
    expect(payeeMatches('State Farm', 'STATEFARM INS PREM')).toBe(true)
    expect(payeeMatches('PG&E', 'PG&E WEB ONLINE')).toBe(true)
  })

  it('accepts a short merchant name made of the payee’s words, and nothing looser', () => {
    expect(payeeMatches('Comcast Xfinity', 'Comcast')).toBe(true)
    expect(payeeMatches('Atmos Energy', 'ATM WITHDRAWAL')).toBe(false)
    expect(payeeMatches('Water', 'Blue Water Grill')).toBe(true)
    expect(payeeMatches('Blue Water Grill', 'Water')).toBe(true)
    expect(payeeMatches('Netflix', 'Spotify')).toBe(false)
  })

  it('allows a dollar or 5% on a fixed bill, more on a variable one', () => {
    const small = { amountCents: 1_000, isVariable: false }
    expect(amountMatches(small, 1_100)).toBe(true)
    expect(amountMatches(small, 1_101)).toBe(false)
    const internet = { amountCents: 8_999, isVariable: false }
    expect(amountMatches(internet, 9_449)).toBe(true)
    expect(amountMatches(internet, 9_450)).toBe(false)
    const mortgage = { amountCents: 250_000, isVariable: false }
    expect(amountMatches(mortgage, 262_500)).toBe(true)
    expect(amountMatches(mortgage, 262_501)).toBe(false)
    const electric = { amountCents: 12_000, isVariable: true }
    expect(amountMatches(electric, 17_900)).toBe(true)
    expect(amountMatches(electric, 18_001)).toBe(false)
    expect(amountMatches({ amountCents: null, isVariable: true }, 1)).toBe(true)
  })
})

const internet: BillForMatching = {
  cadence: 'monthly',
  dueDay: 15,
  dueMonth: null,
  payee: 'Comcast',
  amountCents: 8_999,
  isVariable: false,
  autopay: false,
  accountId: 'checking',
}

let ids = 0
function tx(date: string, amountCents: number, overrides: Partial<PaymentCandidate> = {}): PaymentCandidate {
  ids += 1
  return {
    id: `t${String(ids).padStart(3, '0')}`,
    date,
    amountCents,
    merchantName: 'Comcast',
    name: 'COMCAST CABLE COMM',
    accountId: 'checking',
    isExcluded: false,
    ...overrides,
  }
}

describe('matchBillPayments', () => {
  const dueDates = ['2026-07-15', '2026-08-15', '2026-09-15']

  it('pairs each due date with its payment and flags the unpaid one after its date', () => {
    const july = tx('2026-07-14', -8_999)
    const august = tx('2026-08-17', -8_999)
    const result = matchBillPayments({
      bill: internet,
      dueDates: ['2026-07-15', '2026-08-15', '2026-09-10'],
      transactions: [july, august],
      today: '2026-09-14',
    })
    expect(result.map(occurrence => [occurrence.dueOn, occurrence.status, occurrence.payment?.transactionId ?? null])).toEqual([
      ['2026-07-15', 'paid', july.id],
      ['2026-08-15', 'paid', august.id],
      ['2026-09-10', 'overdue', null],
    ])
  })

  it('leaves a due date that has not passed as due', () => {
    const result = matchBillPayments({ bill: internet, dueDates, transactions: [], today: '2026-09-15', trackedFrom: '2026-09-01' })
    expect(result).toEqual([{ dueOn: '2026-09-15', status: 'due', payment: null }])
  })

  it('gives autopay a few days to post', () => {
    const autopay = { ...internet, autopay: true }
    expect(matchBillPayments({ bill: autopay, dueDates: ['2026-09-10'], transactions: [], today: '2026-09-13' })[0]?.status).toBe('due')
    expect(matchBillPayments({ bill: autopay, dueDates: ['2026-09-10'], transactions: [], today: '2026-09-14' })[0]?.status).toBe(
      'overdue'
    )
  })

  it('uses a transaction once, for the closest due date', () => {
    const payment = tx('2026-08-14', -8_999)
    const result = matchBillPayments({
      bill: { ...internet, cadence: 'quarterly', dueMonth: 2 },
      dueDates: ['2026-08-15', '2026-08-20'],
      transactions: [payment],
      today: '2026-09-14',
    })
    expect(result.map(occurrence => occurrence.status)).toEqual(['paid', 'overdue'])
  })

  it('ignores refunds, excluded rows, other accounts, wrong amounts and payments outside the window', () => {
    const result = matchBillPayments({
      bill: internet,
      dueDates: ['2026-09-15'],
      transactions: [
        tx('2026-09-15', 8_999),
        tx('2026-09-15', -8_999, { isExcluded: true }),
        tx('2026-09-15', -8_999, { accountId: 'savings' }),
        tx('2026-09-15', -20_000),
        tx('2026-08-30', -8_999),
        tx('2026-09-26', -8_999),
      ],
      today: '2026-09-30',
    })
    expect(result[0]?.status).toBe('overdue')
  })

  it('counts a charge typed in by hand, which has no account', () => {
    const cash = tx('2026-09-12', -8_999, { accountId: null, merchantName: null, name: 'Comcast' })
    const [occurrence] = matchBillPayments({ bill: internet, dueDates: ['2026-09-15'], transactions: [cash], today: '2026-09-30' })
    expect(occurrence?.payment).toEqual({ transactionId: cash.id, paidOn: '2026-09-12', amountCents: 8_999 })
  })
})

describe('summarizeBill', () => {
  const paid = (dueOn: string) => ({
    dueOn,
    status: 'paid' as const,
    payment: { transactionId: dueOn, paidOn: dueOn, amountCents: 100 },
  })

  it('leads with a late payment', () => {
    const summary = summarizeBill(
      [paid('2026-07-15'), { dueOn: '2026-08-15', status: 'overdue', payment: null }, { dueOn: '2026-09-15', status: 'due', payment: null }],
      '2026-09-14'
    )
    expect(summary).toMatchObject({ status: 'overdue', dueOn: '2026-08-15', lastPayment: { paidOn: '2026-07-15' } })
    expect(summary && billNeedsAttention(summary, '2026-09-14')).toBe(true)
  })

  it('shows an early payment as paid until the due date passes', () => {
    expect(summarizeBill([paid('2026-09-15'), { dueOn: '2026-10-15', status: 'due', payment: null }], '2026-09-14')).toMatchObject({
      status: 'paid',
      dueOn: '2026-09-15',
    })
    const next = summarizeBill([paid('2026-09-15'), { dueOn: '2026-10-15', status: 'due', payment: null }], '2026-09-16')
    expect(next).toMatchObject({ status: 'due', dueOn: '2026-10-15' })
    expect(next && billNeedsAttention(next, '2026-09-16')).toBe(false)
    expect(next && billNeedsAttention(next, '2026-10-08')).toBe(true)
  })
})
