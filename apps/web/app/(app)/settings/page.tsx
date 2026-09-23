import { ChevronRight, LogOut, Mail, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { signOut } from '@/lib/auth/actions'
import { getPageContext } from '@/lib/auth/context'
import { ROLE_LABELS } from '@/lib/households/roles'
import * as households from '@/lib/households/service'
import { PageHeader } from '../_components/ui/page-header'
import { SectionHeader } from '../_components/ui/section-header'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const { ctx, session } = await getPageContext()
  const { household } = await households.getMyHousehold(ctx, session)

  return (
    <>
      <PageHeader title='Settings' description='Your household and your account' />
      <div className='flex flex-col gap-8'>
        <section aria-labelledby='household-heading'>
          <SectionHeader id='household-heading' title='Household' />
          <Link
            href='/settings/household'
            className='flex min-h-tap items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
          >
            <Users aria-hidden className='size-5 shrink-0 text-ink-muted' />
            <span className='min-w-0 flex-1'>
              <span className='block font-medium break-words'>{household.name}</span>
              <span className='block text-sm text-ink-muted'>Members, roles and invitations</span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
        </section>

        <section aria-labelledby='account-heading'>
          <SectionHeader id='account-heading' title='Account' />
          <Link
            href='/settings/digest'
            className='mb-3 flex min-h-tap items-center gap-3 rounded-card border border-line bg-surface p-4 hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
          >
            <Mail aria-hidden className='size-5 shrink-0 text-ink-muted' />
            <span className='min-w-0 flex-1'>
              <span className='block font-medium break-words'>Daily email</span>
              <span className='block text-sm text-ink-muted'>What’s in it, when it comes, or turn it off</span>
            </span>
            <ChevronRight aria-hidden className='size-5 shrink-0 text-ink-muted' />
          </Link>
          <div className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between'>
            <div className='min-w-0'>
              <p className='text-sm text-ink-muted'>Signed in as</p>
              <p className='font-medium break-all'>{session.email ?? 'An account without email'}</p>
              <p className='text-sm text-ink-muted'>
                {ROLE_LABELS[ctx.role]} in {household.name}
              </p>
            </div>
            <form action={signOut} data-sign-out>
              <Button type='submit' variant='outline' className='w-full md:w-auto'>
                <LogOut aria-hidden />
                Sign out
              </Button>
            </form>
          </div>
        </section>
      </div>
    </>
  )
}
