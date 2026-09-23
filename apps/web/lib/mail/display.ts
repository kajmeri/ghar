// Words for the Gmail link on the review page. Safe for client components.

export const REVIEW_PATH = '/travel/bookings/review'
/** A browser opens this to link Gmail. It isn't an API call. */
export const GMAIL_CONNECT_HREF = '/api/mail/google/connect'

/** What `/travel/bookings/review?gmail=` can report after linking Gmail. */
export const MAIL_CONNECT_STATUSES = ['connected', 'cancelled', 'expired', 'denied', 'taken', 'forbidden', 'unavailable', 'failed'] as const
export type MailConnectStatus = (typeof MAIL_CONNECT_STATUSES)[number]

export const MAIL_CONNECT_MESSAGES: Record<MailConnectStatus, { tone: 'positive' | 'caution'; text: string }> = {
  connected: {
    tone: 'positive',
    text: 'Gmail linked. Ghar looks for new booking confirmations every morning, or use Check now.',
  },
  cancelled: { tone: 'caution', text: 'Linking was cancelled. Nothing was linked.' },
  expired: { tone: 'caution', text: 'That sign-in took too long or came from another session. Try linking again.' },
  denied: {
    tone: 'caution',
    text: 'Google didn’t grant read access to your mail. Try again and allow Ghar to read your email.',
  },
  taken: { tone: 'caution', text: 'That Gmail is already linked in another household.' },
  forbidden: { tone: 'caution', text: 'Your role can’t add bookings, so it can’t link Gmail. Ask an owner.' },
  unavailable: { tone: 'caution', text: 'Gmail linking isn’t set up on this server yet.' },
  failed: { tone: 'caution', text: 'Linking didn’t work. Try again in a minute.' },
}

export function isMailConnectStatus(value: unknown): value is MailConnectStatus {
  return typeof value === 'string' && (MAIL_CONNECT_STATUSES as readonly string[]).includes(value)
}
