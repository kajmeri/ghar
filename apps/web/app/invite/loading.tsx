import { AuthScreenSkeleton } from '@/app/_components/auth-screen'

// Every invitation outcome is a title, a sentence and one full-width button.
export default function InviteLoading() {
  return <AuthScreenSkeleton label='Opening the invitation…' />
}
