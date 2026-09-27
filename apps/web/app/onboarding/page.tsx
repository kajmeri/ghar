import type { MyInvitation } from '@ghar/contracts'
import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthScreen } from '@/app/_components/auth-screen'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import { householdOptions } from '@/lib/households/options'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/households/roles'
import * as households from '@/lib/households/service'
import { countSharedTrips } from '@/lib/travel/guests'
import { JoinHouseholdForm } from './_components/join-household-form'
import { OnboardingForm } from './_components/onboarding-form'

export const metadata: Metadata = { title: 'Set up your household' }

export default async function OnboardingPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login?next=/onboarding')
  if (await getMembership(session)) redirect('/')
  const { timeZones, currencies } = householdOptions()
  const [shared, invitations] = await Promise.all([countSharedTrips(session), households.listMyInvitations(session)])

  const sharedLink =
    shared > 0 ? (
      <p className='text-sm text-ink-muted'>
        Just here for a trip?{' '}
        <Link href='/shared' className='text-ink underline underline-offset-4'>
          See trips shared with you
        </Link>
      </p>
    ) : null

  // Someone invited them, so they came to join. Starting a household of their own is still there.
  if (invitations.length > 0) {
    const [only] = invitations.length === 1 ? invitations : []
    return (
      <AuthScreen
        title={only ? `Join ${only.householdName}` : 'Join a household'}
        description={
          <p>
            {only
              ? `${only.invitedByName ?? 'Someone'} invited you. Join them, or set up a household of your own.`
              : 'You’ve been invited to more than one. Join one, or set up a household of your own.'}
          </p>
        }
      >
        <div className='flex flex-col gap-8'>
          <ul className='flex flex-col gap-4'>
            {invitations.map(invitation => (
              <InvitationCard key={invitation.id} invitation={invitation} />
            ))}
          </ul>
          <details className='border-t border-line pt-4'>
            <summary className='flex min-h-tap cursor-pointer list-none items-center text-base font-medium text-ink underline-offset-4 hover:underline [&::-webkit-details-marker]:hidden'>
              Set up a new household instead
            </summary>
            <div className='mt-4 flex flex-col gap-5'>
              <p className='text-sm text-ink-muted'>
                You’ll be its owner. Ghar allows one household per person, so you won’t be able to join{' '}
                {only ? only.householdName : 'these'} afterwards.
              </p>
              <OnboardingForm timeZones={timeZones} currencies={currencies} />
            </div>
          </details>
          {sharedLink}
        </div>
      </AuthScreen>
    )
  }

  return (
    <AuthScreen
      title='Set up your household'
      description={<p>You’ll be its owner. If someone already set one up, ask them for an invitation instead.</p>}
    >
      <OnboardingForm timeZones={timeZones} currencies={currencies} />
      {sharedLink}
    </AuthScreen>
  )
}

function InvitationCard({ invitation }: { invitation: MyInvitation }) {
  return (
    <li className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4'>
      <div className='flex flex-col gap-1'>
        <p className='font-medium'>{invitation.householdName}</p>
        <p className='text-sm text-ink-muted'>
          {invitation.invitedByName ?? 'Someone'} invited you with the {ROLE_LABELS[invitation.role]} role.{' '}
          {ROLE_DESCRIPTIONS[invitation.role]}
        </p>
      </div>
      <JoinHouseholdForm invitationId={invitation.id} householdName={invitation.householdName} />
    </li>
  )
}
