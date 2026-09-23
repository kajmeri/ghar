import { AuthScreenSkeleton } from '@/app/_components/auth-screen'

// Most outcomes of a one-tap link are a title, a sentence and one full-width button.
export default function OneTapLoading() {
  return <AuthScreenSkeleton label='Checking the link…' />
}
