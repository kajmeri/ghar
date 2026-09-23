import { cookies } from 'next/headers'
import type { ReactNode } from 'react'
import { getPageSession } from '@/lib/api/authed'
import { SIDEBAR_COOKIE } from './_components/nav'
import { Sidebar } from './_components/sidebar'
import { TabBar } from './_components/tab-bar'

export default async function AppLayout({ children }: { children: ReactNode }) {
  // The page asks for the same session; it's resolved once for both.
  const [{ household }, cookieStore] = await Promise.all([getPageSession(), cookies()])

  return (
    <div className='flex min-h-dvh'>
      {/* First thing a keyboard reaches, so nobody tabs through the whole sidebar on every page. */}
      <a
        href='#main'
        className='sr-only focus:not-sr-only focus:fixed focus:top-[max(--spacing(4),env(safe-area-inset-top))] focus:left-4 focus:z-50 focus:inline-flex focus:min-h-tap focus:items-center focus:rounded-control focus:bg-ink focus:px-4 focus:text-base focus:font-medium focus:text-surface'
      >
        Skip to content
      </a>
      <Sidebar householdName={household.name} defaultCollapsed={cookieStore.get(SIDEBAR_COOKIE)?.value === 'collapsed'} />
      <div className='min-w-0 flex-1'>
        {/* On phones the bottom padding clears the fixed tab bar and the home indicator. */}
        <main
          id='main'
          tabIndex={-1}
          className='mx-auto w-full focus:outline-hidden max-w-content pt-[max(--spacing(6),env(safe-area-inset-top))] pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[calc(--spacing(24)+env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:px-8 md:pt-10 md:pb-16'>
          {children}
        </main>
      </div>
      <TabBar />
    </div>
  )
}
