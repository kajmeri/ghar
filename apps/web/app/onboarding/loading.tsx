import { AuthScreenSkeleton } from '@/app/_components/auth-screen'

// Mirrors OnboardingForm: name and time zone with hints, currency without, then the button.
export default function OnboardingLoading() {
  return <AuthScreenSkeleton fields={[true, true, false]} gap='gap-5' />
}
