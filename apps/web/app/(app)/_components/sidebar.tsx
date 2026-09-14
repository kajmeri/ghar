'use client'

import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { isActive, SETTINGS, SIDEBAR_COOKIE, SIDEBAR_GROUPS, type NavItem } from './nav'

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365

export function Sidebar({ householdName, defaultCollapsed }: { householdName: string; defaultCollapsed: boolean }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    document.cookie = `${SIDEBAR_COOKIE}=${next ? 'collapsed' : 'expanded'}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; samesite=lax`
  }

  return (
    <aside
      className={cn('sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface md:flex print:hidden', collapsed ? 'w-18' : 'w-60')}
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
          className='flex size-tap shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-paper hover:text-ink focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none'
        >
          {collapsed ? <PanelLeftOpen aria-hidden className='size-5' /> : <PanelLeftClose aria-hidden className='size-5' />}
          <span className='sr-only'>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</span>
        </button>
      </div>

      <nav id='sidebar-nav' aria-label='Primary' className='flex flex-1 flex-col overflow-y-auto px-3 pb-4'>
        <div className='flex flex-1 flex-col gap-6'>
          {SIDEBAR_GROUPS.map((group, index) => (
            <div key={group.label ?? index}>
              {group.label && !collapsed ? <p className='px-3 pb-1 text-sm text-ink-muted'>{group.label}</p> : null}
              <ul className='flex flex-col gap-0.5'>
                {group.items.map(item => (
                  <li key={item.href}>
                    <SidebarLink item={item} pathname={pathname} collapsed={collapsed} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className='border-t border-line pt-3'>
          <SidebarLink item={SETTINGS} pathname={pathname} collapsed={collapsed} />
        </div>
      </nav>
    </aside>
  )
}

function SidebarLink({ item, pathname, collapsed }: { item: NavItem; pathname: string; collapsed: boolean }) {
  const active = isActive(pathname, item.href)
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
      className={cn(
        'flex h-tap items-center gap-3 rounded-control px-3 text-base focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
        collapsed && 'justify-center px-0',
        active ? 'bg-paper font-medium text-ink' : 'text-ink-muted hover:bg-paper hover:text-ink'
      )}
    >
      <Icon aria-hidden className='size-5 shrink-0' />
      <span className={collapsed ? 'sr-only' : 'truncate'}>{item.label}</span>
    </Link>
  )
}
