// What signing the phone in needs from the identity provider, in domain shapes. The provider
// proves who someone is; Ghar issues its own tokens afterwards and keeps nothing the provider
// hands back beyond the person's id and email.

/** The link types a magic link's token hash can carry. */
export type EmailLinkType = 'email' | 'magiclink' | 'signup'

/** The person an emailed code or link belongs to. */
export interface VerifiedEmailUser {
  userId: string
  email: string | null
}

export interface EmailOtpProvider {
  /**
   * Emails a sign-in link with a code in it, creating the account when there isn't one.
   * `redirectTo` is where the link lands in a browser.
   */
  sendCode(input: { email: string; redirectTo: string }): Promise<void>
  /** Throws EmailOtpError with reason `rejected` when the code is wrong, expired or used. */
  verifyCode(input: { email: string; code: string }): Promise<VerifiedEmailUser>
  /** The same check, for the token hash in a sign-in link. */
  verifyTokenHash(input: { tokenHash: string; type: EmailLinkType }): Promise<VerifiedEmailUser>
}

export type EmailOtpFailure =
  /** Too many emails or attempts. Wait, then try again. */
  | 'rate_limited'
  /** The provider won't send to this address. */
  | 'invalid_email'
  /** The code or link is wrong, expired or already used. */
  | 'rejected'
  /** The provider is set up to refuse sign-ups or email codes. A configuration problem. */
  | 'disabled'
  /** Anything else: down, slow, or an answer we didn't expect. */
  | 'unavailable'

/** Messages are ours and never include the address, the code or anything the provider sent. */
export class EmailOtpError extends Error {
  override readonly name = 'EmailOtpError'
  readonly reason: EmailOtpFailure

  constructor(reason: EmailOtpFailure, message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.reason = reason
  }
}
