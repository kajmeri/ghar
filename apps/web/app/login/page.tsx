import { safeRedirectPath } from '@ghar/core/redirects'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { AuthScreen } from '@/app/_components/auth-screen'
import { getSessionContext } from '@/lib/auth/context'
import { LoginForm } from './_components/login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const next = safeRedirectPath(first(params.next))
  if (await getSessionContext()) redirect(next)

  const linkFailed = first(params.error) === 'link'
  return (
    <AuthScreen
      title='Sign in'
      description={
        linkFailed ? (
          <p className='text-negative'>That link has expired or was already used. Send yourself a new one.</p>
        ) : (
          <p>We’ll email you a link. No password needed.</p>
        )
      }
    >
      <LoginForm next={next === '/' ? undefined : next} />
    </AuthScreen>
  )
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}
