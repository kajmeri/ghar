import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AuthScreen } from '@/app/_components/auth-screen'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import { householdOptions } from '@/lib/households/options'
import { countSharedTrips } from '@/lib/travel/guests'
import { OnboardingForm } from './_components/onboarding-form'

export const metadata: Metadata = { title: 'Set up your household' }

export default async function OnboardingPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login?next=/onboarding')
  if (await getMembership(session)) redirect('/')
  const { timeZones, currencies } = householdOptions()
  const shared = await countSharedTrips(session)

  return (
    <AuthScreen
      title='Set up your household'
      description={<p>You’ll be its owner. If someone already set one up, ask them for an invitation instead.</p>}
    >
      <OnboardingForm timeZones={timeZones} currencies={currencies} />
      {shared > 0 ? (
        <p className='text-sm text-ink-muted'>
          Just here for a trip?{' '}
          <Link href='/shared' className='text-ink underline underline-offset-4'>
            See trips shared with you
          </Link>
        </p>
      ) : null}
    </AuthScreen>
  )
}
