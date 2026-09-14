import { invitationTokenBodySchema, type InvitationPreview } from '@ghar/contracts'
import { NotFoundError } from '@ghar/core/errors'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthScreen } from '@/app/_components/auth-screen'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import { getMembership, getSessionContext, type SessionContext } from '@/lib/auth/context'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/households/roles'
import * as households from '@/lib/households/service'
import { AcceptInvitationForm } from './_components/accept-invitation-form'

// The token is a bearer secret in the URL, so never leak it to another origin through Referer.
export const metadata: Metadata = { title: 'Invitation', referrer: 'no-referrer' }

export default async function InvitePage({ searchParams }: PageProps<'/invite'>) {
  const { token: tokenParam } = await searchParams
  const parsed = invitationTokenBodySchema.safeParse({
    token: Array.isArray(tokenParam) ? tokenParam[0] : tokenParam,
  })
  if (!parsed.success) return <InvalidInvitation />
  const { token } = parsed.data
  const invitePath = `/invite?token=${encodeURIComponent(token)}`

  const session = await getSessionContext()
  if (!session) redirect(`/login?next=${encodeURIComponent(invitePath)}`)

  const [preview, membership] = await Promise.all([loadPreview(session, token), getMembership(session)])
  if (!preview) return <InvalidInvitation />

  if (preview.status === 'accepted') {
    return (
      <AuthScreen title='This invitation has been used' description={<p>Each link works once. If you already joined, you’re all set.</p>}>
        <ContinueLink />
      </AuthScreen>
    )
  }

  if (preview.status === 'expired') {
    return (
      <AuthScreen
        title='This invitation has expired'
        description={<p>Ask {preview.invitedByName ?? 'whoever invited you'} to resend it from household settings.</p>}
      >
        {membership ? <ContinueLink /> : null}
      </AuthScreen>
    )
  }

  if (!preview.forYou) {
    return (
      <AuthScreen
        title={`This invitation is for ${preview.email}`}
        description={
          <p>
            You’re signed in as {session.email ?? 'a different account'}. Sign out, then sign in with {preview.email} to accept it.
          </p>
        }
      >
        <form action={signOut}>
          <input type='hidden' name='next' value={invitePath} />
          <Button type='submit' className='w-full'>
            Sign out and switch
          </Button>
        </form>
      </AuthScreen>
    )
  }

  if (membership) {
    return (
      <AuthScreen
        title='You’re already in a household'
        description={<p>Ghar allows one household per person, so this account can’t join {preview.householdName}.</p>}
      >
        <ContinueLink />
      </AuthScreen>
    )
  }

  return (
    <AuthScreen
      title={`Join ${preview.householdName}`}
      description={
        <p>
          {preview.invitedByName ?? 'Someone'} invited you with the {ROLE_LABELS[preview.role]} role. {ROLE_DESCRIPTIONS[preview.role]}
        </p>
      }
    >
      <AcceptInvitationForm token={token} />
    </AuthScreen>
  )
}

async function loadPreview(session: SessionContext, token: string): Promise<InvitationPreview | null> {
  try {
    return await households.previewInvitation(session, token)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

function InvalidInvitation() {
  return (
    <AuthScreen
      title='This invitation link isn’t valid'
      description={<p>Make sure you opened the whole link from the email, or ask whoever invited you for a new one.</p>}
    >
      <ContinueLink />
    </AuthScreen>
  )
}

function ContinueLink() {
  return (
    <Button asChild variant='outline' className='w-full'>
      <Link href='/'>Go to Ghar</Link>
    </Button>
  )
}
