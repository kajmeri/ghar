import { MAIL_LINK_STATUSES } from '@ghar/core/mail'
import { describe, expect, it } from 'vitest'
import { mailBookingDraftSchema, mailLinkSchema, mailLinkStatusSchema } from '../src/v1/mail'

describe('mail contracts', () => {
  it('mirrors the link statuses in core', () => {
    expect(mailLinkStatusSchema.options).toEqual([...MAIL_LINK_STATUSES])
  })

  it('has no field that could carry a refresh token', () => {
    expect(Object.keys(mailLinkSchema.shape)).not.toContain('refreshToken')
    expect(Object.keys(mailLinkSchema.shape)).not.toContain('refreshTokenEncrypted')
  })

  it('accepts a draft the model could not fully read', () => {
    const draft = {
      id: '0b8c8f7e-3f7a-4f0e-9b8e-6a1d2c3b4a5f',
      messageId: '18f2a',
      receivedAt: '2026-09-12T15:00:00.000Z',
      senderDomain: 'united.com',
      subject: 'Your flight confirmation',
      booking: null,
      problems: {},
      createdAt: '2026-09-13T11:00:00.000Z',
    }
    expect(mailBookingDraftSchema.parse(draft)).toEqual(draft)
  })
})
