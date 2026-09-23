import { describe, expect, it } from 'vitest'
import { createResendProvider, EMAIL_FROM, EMAIL_REPLY_TO } from '@/lib/providers/email'

describe('createResendProvider', () => {
  it('sends from the fixed sender with replies going to the household inbox', async () => {
    let body: unknown
    const provider = createResendProvider({
      apiKey: 're_test',
      from: EMAIL_FROM,
      replyTo: EMAIL_REPLY_TO,
      fetch: (_url, init) => {
        body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
        return Promise.resolve(Response.json({ id: 'email-1' }))
      },
    })

    await expect(provider.send({ to: 'sam@example.com', subject: 'Hi', text: 'Hi', html: '<p>Hi</p>' })).resolves.toEqual({ id: 'email-1' })
    expect(body).toMatchObject({ from: 'Ghar <onboarding@resend.dev>', reply_to: 'krishnapajmeri@gmail.com', to: ['sam@example.com'] })
  })
})
