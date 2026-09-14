import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { getPageContext } from '@/lib/auth/context'
import * as households from '@/lib/households/service'
import { SIDEBAR_COOKIE } from './_components/nav'
import { Sidebar } from './_components/sidebar'
import { TabBar } from './_components/tab-bar'

export default async function AppLayout({ children }: { children: ReactNode }) {
  const { ctx, session } = await getPageContext()
  const [{ household }, cookieStore] = await Promise.all([households.getMyHousehold(ctx, session), cookies()])

  return (
    <div className='flex min-h-dvh'>
      <Sidebar householdName={household.name} defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'} />
      <div className='min-w-0 flex-1'>
        {/* On phones the bottom padding clears the fixed tab bar and the home indicator. */}
        <main className='mx-auto w-full max-w-content pt-[max(--spacing(6),env(safe-area-inset-top))] pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[calc(--spacing(24)+env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:px-8 md:pt-10 md:pb-16'>
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  )
}
