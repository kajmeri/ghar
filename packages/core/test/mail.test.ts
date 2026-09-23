import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  MAIL_BODY_MAX_CHARS,
  bookingExtractSchema,
  bookingFromExtract,
  bookingProblems,
  buildConfirmationQuery,
  htmlToText,
  isConfirmationSender,
  mailSearchStart,
  messageText,
  redactPii,
  senderDomain,
  type BookingExtract,
} from '../src/mail'

const household = { timeZone: 'America/Los_Angeles', currency: 'USD' }

const nothing: BookingExtract = {
  isBooking: false,
  kind: null,
  status: null,
  confirmationCode: null,
  providerName: null,
  carrier: null,
  cabin: null,
  ratePlan: null,
  refundable: null,
  origin: null,
  destination: null,
  propertyName: null,
  checkIn: null,
  checkOut: null,
  departAt: null,
  returnAt: null,
  travelers: null,
  totalPaid: null,
  currency: null,
}

const flight: BookingExtract = {
  ...nothing,
  isBooking: true,
  kind: 'flight',
  confirmationCode: 'K7QX2P',
  providerName: 'Delta',
  carrier: 'Delta Air Lines',
  cabin: 'economy',
  refundable: false,
  origin: 'SFO',
  destination: 'JFK',
  departAt: '2026-10-02T07:15',
  returnAt: '2026-10-09 18:40:00',
  travelers: 2,
  totalPaid: '1,234.56',
}

describe('buildConfirmationQuery', () => {
  it('asks for confirmations from travel senders since a time, never the whole inbox', () => {
    const query = buildConfirmationQuery({ after: new Date('2026-09-13T11:00:00Z') })
    expect(query).toMatch(/^from:\((\S+ OR )+\S+\) /)
    expect(query).toContain('united.com OR ')
    expect(query).toContain('subject:(confirmation OR ')
    expect(query).toContain('"e-ticket"')
    expect(query).toContain('"trip details"')
    expect(query).toContain(`after:${Date.parse('2026-09-13T11:00:00Z') / 1000}`)
    expect(query).toMatch(/ -in:spam -in:trash$/)
  })

  it('refuses a start time that isn’t one', () => {
    expect(() => buildConfirmationQuery({ after: new Date('nope') })).toThrow('real start time')
  })
})

describe('mailSearchStart', () => {
  const linkedAt = new Date('2026-09-14T12:00:00Z')

  it('looks back a month the first time', () => {
    expect(mailSearchStart({ lastCheckedAt: null, linkedAt })).toEqual(new Date('2026-08-15T12:00:00Z'))
  })

  it('overlaps the last check by an hour after that', () => {
    expect(mailSearchStart({ lastCheckedAt: new Date('2026-09-15T11:00:00Z'), linkedAt })).toEqual(new Date('2026-09-15T10:00:00Z'))
  })
})

describe('senders', () => {
  it('reads the domain from a From header', () => {
    expect(senderDomain('United Airlines <Receipts@News.United.com>')).toBe('news.united.com')
    expect(senderDomain('no-reply@expedia.com')).toBe('expedia.com')
    expect(senderDomain('Mailer Daemon')).toBeNull()
  })

  it('trusts a known domain and its subdomains, not lookalikes', () => {
    expect(isConfirmationSender('news.united.com')).toBe(true)
    expect(isConfirmationSender('marriott.com')).toBe(true)
    expect(isConfirmationSender('notunited.com')).toBe(false)
    expect(isConfirmationSender('united.com.example.net')).toBe(false)
    expect(isConfirmationSender(null)).toBe(false)
  })
})

describe('redactPii', () => {
  it('replaces addresses, card and phone numbers, long numbers and booking codes', () => {
    expect(redactPii('token refresh failed for jane.doe@gmail.com')).toBe('token refresh failed for [email]')
    expect(redactPii('card 4111 1111 1111 1111 declined')).toBe('card [card] declined')
    expect(redactPii('call (415) 555-0134')).toBe('call [phone]')
    expect(redactPii('ticket 00612345 for K7QX2P')).toBe('ticket [number] for [code]')
  })

  it('leaves ordinary error text alone', () => {
    expect(redactPii('Gmail answered 429 Too Many Requests: invalid_grant')).toBe('Gmail answered 429 Too Many Requests: invalid_grant')
  })
})

describe('message text', () => {
  it('flattens HTML to lines, without styles or scripts', () => {
    const html = `<html><head><style>p { color: red }</style></head><body>
      <p>Confirmation&nbsp;<b>K7QX2P</b></p>
      <!-- tracking -->
      <table><tr><td>Total</td><td>$1,234.56</td></tr></table>
      <script>track()</script>
      <p>Don&#39;t forget &amp; enjoy&#x2014;bye &bogus;</p>
    </body></html>`
    expect(htmlToText(html)).toBe("Confirmation K7QX2P\n\nTotal $1,234.56\n\nDon't forget & enjoy—bye &bogus;")
  })

  it('prefers a plain part that says something, and cuts long messages', () => {
    const plain = 'Your trip is confirmed. '.repeat(20)
    expect(messageText({ plain, html: '<p>Other</p>' })).toBe(plain.trim())
    expect(messageText({ plain: 'View in browser', html: '<p>Your stay is confirmed</p>' })).toBe('Your stay is confirmed')
    expect(messageText({ plain: 'x'.repeat(MAIL_BODY_MAX_CHARS + 50), html: null })).toHaveLength(MAIL_BODY_MAX_CHARS)
  })
})

describe('bookingExtractSchema', () => {
  it('requires every field, so the model can’t leave one out', () => {
    const schema = z.toJSONSchema(bookingExtractSchema)
    expect(schema.required).toEqual(Object.keys(bookingExtractSchema.shape))
    expect(bookingExtractSchema.safeParse({ isBooking: false }).success).toBe(false)
  })
})

describe('bookingFromExtract', () => {
  it('turns a flight into a draft that would save, reading times in the household’s zone', () => {
    const draft = bookingFromExtract(flight, household)
    expect(draft).toMatchObject({
      kind: 'flight',
      status: 'booked',
      carrier: 'DL',
      departAt: new Date('2026-10-02T14:15:00Z'),
      returnAt: new Date('2026-10-10T01:40:00Z'),
      travelers: 2,
      paidCents: 123_456,
      currency: 'USD',
      watchEnabled: true,
    })
    expect(draft && bookingProblems(draft)).toEqual({})
  })

  it('is nothing for a message that isn’t a booking', () => {
    expect(bookingFromExtract(nothing, household)).toBeNull()
    expect(bookingFromExtract({ ...flight, kind: null }, household)).toBeNull()
  })

  it('keeps what it can’t read as a problem to fix, not a guess', () => {
    const draft = bookingFromExtract(
      {
        ...nothing,
        isBooking: true,
        kind: 'hotel',
        status: 'cancelled',
        propertyName: 'Hotel Nikko',
        destination: 'San Francisco',
        ratePlan: 'refundable',
        checkIn: '2026-10-02',
        checkOut: 'Oct 5',
        totalPaid: 'free',
        currency: 'eur',
      },
      household
    )
    expect(draft).toMatchObject({ status: 'cancelled', checkIn: '2026-10-02', checkOut: null, paidCents: null, currency: 'EUR', travelers: 1 })
    expect(draft && Object.keys(bookingProblems(draft)).toSorted()).toEqual(['checkOut', 'paidCents'])
  })

  it('keeps an airline it doesn’t know by name, and drops times it can’t read', () => {
    const draft = bookingFromExtract({ ...flight, carrier: 'Condor', departAt: 'Oct 2 at 7:15am', totalPaid: '0' }, household)
    expect(draft).toMatchObject({ carrier: 'Condor', departAt: null, paidCents: null })
    expect(draft && Object.keys(bookingProblems(draft)).toSorted()).toEqual(['carrier', 'departAt', 'paidCents'])
  })

  it('uppercases a two-character airline code', () => {
    expect(bookingFromExtract({ ...flight, carrier: 'ua' }, household)?.carrier).toBe('UA')
  })
})
