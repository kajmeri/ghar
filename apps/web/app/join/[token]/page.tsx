import { guestResponseSchema, partySizeSchema, tripInviteTokenSchema, type GuestResponseValue, type TripInvitePreview } from '@ghar/contracts'
import { NotFoundError } from '@ghar/core/errors'
import { GUEST_RESPONSE_LABELS } from '@ghar/core/trip-guests'
import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { SharedTripFrame, SharedTripHero, WhoIsGoing } from '@/app/_components/shared-trip'
import { TripAnswerForm } from '@/app/_components/trip-answer-form'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import { getSessionContext } from '@/lib/auth/context'
import * as guests from '@/lib/travel/guests'
import { answerTripInviteAction, sendAnswerLinkAction } from './actions'

// A trip invitation: from an email, or the trip's link. Anyone holding it sees the same safe
// preview; answering needs a sign-in, which the form sends and which comes back here.

// The token is a bearer secret in the URL, so never leak it to another origin through Referer.
export const metadata: Metadata = { title: 'Trip invitation', referrer: 'no-referrer', robots: { index: false } }

export default async function JoinPage({ params, searchParams }: PageProps<'/join/[token]'>) {
  const parsed = tripInviteTokenSchema.safeParse((await params).token)
  if (!parsed.success) return <InvalidInvite />
  const token = parsed.data
  const joinPath = `/join/${encodeURIComponent(token)}`

  const session = await getSessionContext()
  const invite = await loadPreview(session, token)
  if (!invite) return <InvalidInvite />

  // Back from the sign-in link with the answer they picked.
  const query = await searchParams
  const picked = guestResponseSchema.safeParse(query.answer)
  const party = partySizeSchema.safeParse(query.party)

  const eyebrow = `${invite.invitedByName ?? 'Someone'} from ${invite.trip.householdName} invited you`

  return (
    <SharedTripFrame home={session ? '/' : '/login'}>
      <div className='flex flex-col gap-6'>
        <SharedTripHero trip={invite.trip} eyebrow={eyebrow} />
        <WhoIsGoing going={invite.going} />
        <section aria-labelledby='answer-heading' className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'>
          <Answer
            invite={invite}
            token={token}
            joinPath={joinPath}
            signedInAs={session?.email ?? null}
            picked={picked.success ? picked.data : null}
            party={party.success ? party.data : null}
          />
        </section>
      </div>
    </SharedTripFrame>
  )
}

function Answer({
  invite,
  token,
  joinPath,
  signedInAs,
  picked,
  party,
}: {
  invite: TripInvitePreview
  token: string
  joinPath: string
  signedInAs: string | null
  picked: GuestResponseValue | null
  party: number | null
}) {
  if (invite.inHousehold) {
    return (
      <AnswerBlock title='This is your household’s trip' body='You’re already on it, so there’s nothing to answer.'>
        <Button asChild>
          <Link href={`/travel/${invite.trip.id}`}>Open the trip</Link>
        </Button>
      </AnswerBlock>
    )
  }

  if (invite.signedIn && !invite.forYou) {
    return (
      <AnswerBlock
        title={`This invitation is for ${invite.invitedEmail ?? 'someone else'}`}
        body={`You’re signed in as ${signedInAs ?? 'a different account'}. Sign out, then sign in with ${invite.invitedEmail ?? 'that address'} to answer.`}
      >
        <form action={signOut}>
          <input type='hidden' name='next' value={joinPath} />
          <Button type='submit' variant='outline' className='w-full'>
            Sign out and switch
          </Button>
        </form>
      </AnswerBlock>
    )
  }

  const mine = invite.mine
  const defaultResponse = picked ?? mine?.response ?? null
  const form = (label: string) => (
    <TripAnswerForm
      action={invite.signedIn ? answerTripInviteAction : sendAnswerLinkAction}
      hidden={{ token }}
      signedIn={invite.signedIn}
      defaultResponse={defaultResponse}
      defaultPartySize={party ?? mine?.partySize ?? 1}
      needsName={invite.needsName}
      defaultEmail={invite.invitedEmail}
      submitLabel={label}
    />
  )

  if (mine?.response) {
    const waiting = mine.status === 'asked'
    const people = mine.partySize === 1 ? '' : ` · ${String(mine.partySize)} people`
    return (
      <>
        <AnswerBlock
          title={`You said ${GUEST_RESPONSE_LABELS[mine.response].toLowerCase()}${people}`}
          body={
            waiting
              ? `${invite.trip.householdName} lets people in by hand. You’ll see the trip once they do.`
              : 'Change your answer any time.'
          }
        >
          {waiting ? null : (
            <Button asChild variant='outline'>
              <Link href={`/shared/${invite.trip.id}`}>Open the trip</Link>
            </Button>
          )}
        </AnswerBlock>
        {form('Update answer')}
      </>
    )
  }

  return (
    <>
      <h2 id='answer-heading' className='text-lg font-semibold'>
        {picked && invite.signedIn ? 'Send your answer' : 'Are you in?'}
      </h2>
      {invite.requiresApproval ? (
        <p className='-mt-2 text-sm text-ink-muted'>{invite.trip.householdName} lets people in by hand, so they’ll see your answer first.</p>
      ) : null}
      {form('Send answer')}
    </>
  )
}

function AnswerBlock({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className='flex flex-col gap-3'>
      <div className='flex flex-col gap-1'>
        <h2 id='answer-heading' className='text-lg font-semibold'>
          {title}
        </h2>
        <p className='text-base text-ink-muted'>{body}</p>
      </div>
      {children}
    </div>
  )
}

async function loadPreview(session: Awaited<ReturnType<typeof getSessionContext>>, token: string): Promise<TripInvitePreview | null> {
  try {
    return await guests.previewTripInvite(session, token)
  } catch (error) {
    if (error instanceof NotFoundError) return null
    throw error
  }
}

function InvalidInvite() {
  return (
    <SharedTripFrame>
      <div className='flex flex-col gap-2'>
        <h1 className='text-2xl font-semibold'>This invitation isn’t working</h1>
        <p className='text-base text-ink-muted'>
          The link may have been turned off or replaced. Ask whoever sent it for a new one, and open the whole link.
        </p>
      </div>
    </SharedTripFrame>
  )
}
