import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthScreen } from '@/app/_components/auth-screen'
import { getMembership, getSessionContext } from '@/lib/auth/context'
import { householdOptions } from '@/lib/households/options'
import { OnboardingForm } from './_components/onboarding-form'

export const metadata: Metadata = { title: 'Set up your household' }

export default async function OnboardingPage() {
  const session = await getSessionContext()
  if (!session) redirect('/login?next=/onboarding')
  if (await getMembership(session)) redirect('/')
  const { timeZones, currencies } = householdOptions()

  return (
    <AuthScreen
      title='Set up your household'
      description={<p>You’ll be its owner. If someone already set one up, ask them for an invitation instead.</p>}
    >
      <OnboardingForm timeZones={timeZones} currencies={currencies} />
    </AuthScreen>
  )
}
