import 'server-only'
import { randomBytes, randomInt } from 'node:crypto'
import { EmailOtpError, type EmailLinkType, type EmailOtpProvider, type VerifiedEmailUser } from './types'

// Email sign-in that lives in memory, for tests. Nothing is emailed: each send is recorded with its
// code and token hash, which a test reads back. The fake can't create accounts, so register the
// person's auth user id in `users` before they verify; an unregistered address sends fine and then
// fails to verify, the way a real account that was deleted in between would.

export interface FakeSentCode {
  email: string
  code: string
  tokenHash: string
  redirectTo: string
  used: boolean
}

export class FakeEmailOtpStore {
  /** Normalized email to auth user id. */
  readonly users = new Map<string, string>()
  readonly sent: FakeSentCode[] = []
  /** When true, sends and verifies fail as rate limited. */
  rateLimited = false

  /** The most recent send to an address. */
  lastSent(email: string): FakeSentCode | undefined {
    return this.sent.findLast(entry => entry.email === email.toLowerCase())
  }

  reset(): void {
    this.users.clear()
    this.sent.length = 0
    this.rateLimited = false
  }
}

const globalForOtp = globalThis as typeof globalThis & { gharFakeEmailOtp?: FakeEmailOtpStore }

export function fakeEmailOtpStore(): FakeEmailOtpStore {
  globalForOtp.gharFakeEmailOtp ??= new FakeEmailOtpStore()
  return globalForOtp.gharFakeEmailOtp
}

export function createFakeEmailOtpProvider(options: { store?: FakeEmailOtpStore } = {}): EmailOtpProvider {
  const store = options.store ?? fakeEmailOtpStore()

  function assertNotLimited(): void {
    if (store.rateLimited) throw new EmailOtpError('rate_limited', 'The fake is limiting sign-in.')
  }

  function consume(entry: FakeSentCode | undefined): VerifiedEmailUser {
    const userId = entry && !entry.used ? store.users.get(entry.email) : undefined
    if (!entry || userId === undefined) throw new EmailOtpError('rejected', 'The fake did not accept the code.')
    entry.used = true
    return { userId, email: entry.email }
  }

  return {
    sendCode({ email, redirectTo }) {
      assertNotLimited()
      store.sent.push({
        email: email.toLowerCase(),
        code: String(randomInt(0, 1_000_000)).padStart(6, '0'),
        tokenHash: randomBytes(28).toString('hex'),
        redirectTo,
        used: false,
      })
      return Promise.resolve()
    },

    verifyCode({ email, code }) {
      return settle(() => {
        assertNotLimited()
        return consume(store.sent.findLast(entry => entry.email === email.toLowerCase() && entry.code === code))
      })
    },

    verifyTokenHash({ tokenHash }: { tokenHash: string; type: EmailLinkType }) {
      return settle(() => {
        assertNotLimited()
        return consume(store.sent.find(entry => entry.tokenHash === tokenHash))
      })
    },
  }
}

function settle<T>(work: () => T): Promise<T> {
  try {
    return Promise.resolve(work())
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)))
  }
}
