import 'server-only'
import { z } from 'zod'
import { env } from '@/lib/env'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export interface SentEmail {
  id: string
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<SentEmail>
}

export class EmailDeliveryError extends Error {
  override readonly name = 'EmailDeliveryError'
}

const resendSuccessSchema = z.object({ id: z.string() })
const resendErrorSchema = z.object({ message: z.string() })

export function createResendProvider(options: { apiKey: string; from: string; fetch?: typeof globalThis.fetch }): EmailProvider {
  const fetchImpl = options.fetch ?? globalThis.fetch
  return {
    async send(message) {
      const response = await fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${options.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          from: options.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      })
      const payload: unknown = await response.json().catch(() => undefined)

      if (!response.ok) {
        const error = resendErrorSchema.safeParse(payload)
        const reason = error.success ? `: ${error.data.message}` : ''
        throw new EmailDeliveryError(`Resend refused the email with ${response.status}${reason}`)
      }
      const sent = resendSuccessSchema.safeParse(payload)
      if (!sent.success) throw new EmailDeliveryError('Resend returned an unexpected response')
      return { id: sent.data.id }
    },
  }
}

/** Local development without a Resend key. Prints each message, links included, to the server console. */
export function createConsoleProvider(): EmailProvider {
  return {
    send(message) {
      console.info(`\n[email] to ${message.to}\n[email] ${message.subject}\n\n${message.text}\n`)
      return Promise.resolve({ id: `console-${crypto.randomUUID()}` })
    },
  }
}

/** For tests: keeps what would have been sent. */
export function createMemoryProvider(): EmailProvider & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = []
  return {
    sent,
    send(message) {
      sent.push(message)
      return Promise.resolve({ id: `memory-${sent.length}` })
    },
  }
}

let provider: EmailProvider | undefined

export function getEmailProvider(): EmailProvider {
  if (provider) return provider
  const { RESEND_API_KEY, EMAIL_FROM } = env()
  if (RESEND_API_KEY) {
    provider = createResendProvider({ apiKey: RESEND_API_KEY, from: EMAIL_FROM })
  } else if (process.env.NODE_ENV === 'production') {
    // The console fallback would write invitation links into production logs.
    throw new Error('RESEND_API_KEY is not set, and production cannot print emails instead.')
  } else {
    provider = createConsoleProvider()
  }
  return provider
}
