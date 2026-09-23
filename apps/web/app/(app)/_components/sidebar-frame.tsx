'use client'

import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { SidebarCollapsedContext } from './nav-link'
import { SIDEBAR_COOKIE } from './nav-cookie'

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

/**
 * The sidebar's collapse state: the aside's width, the household name, and the toggle that
 * remembers the choice in a cookie. The navigation inside is rendered on the server and reads the
 * state through `data-collapsed` on this element (group/sidebar).
 */
export function SidebarFrame({
  householdName,
  defaultCollapsed,
  expandIcon,
  collapseIcon,
  children,
}: {
  householdName: string
  defaultCollapsed: boolean
  expandIcon: ReactNode
  collapseIcon: ReactNode
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`
  }

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'group/sidebar sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface md:flex print:hidden',
        collapsed ? 'w-18' : 'w-60'
      )}
    >
      <div className={cn('flex h-16 items-center gap-2 px-3', collapsed ? 'justify-center' : 'justify-between')}>
        {collapsed ? null : (
          <p className='truncate pl-2 text-base font-semibold' title={householdName}>
            {householdName}
          </p>
        )}
        <button
          type='button'
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-controls='sidebar-nav'
          className='flex size-tap shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden'
        >
          {collapsed ? expandIcon : collapseIcon}
          <span className='sr-only'>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>

      <SidebarCollapsedContext value={collapsed}>{children}</SidebarCollapsedContext>
    </aside>
  )
}
