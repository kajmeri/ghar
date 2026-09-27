import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ComponentProps } from 'react'
import { SETTINGS, SIDEBAR_GROUPS, type NavItem } from './nav'
import { NavLink } from './nav-link'
import { QuickLogLauncher } from './quick-log-launcher'
import { SidebarFrame } from './sidebar-frame'

// Rendered on the server. SidebarFrame holds the collapse state; the classes below follow it
// through its data-collapsed attribute, and NavLink marks the current page.
const COLLAPSED = 'group-data-[collapsed=true]/sidebar'

export function Sidebar({
  householdName,
  defaultCollapsed,
  quickLog,
}: {
  householdName: string
  defaultCollapsed: boolean
  /** What the quick log needs, or null for someone it can't help. */
  quickLog: ComponentProps<typeof QuickLogLauncher> | null
}) {
  return (
    <SidebarFrame
      householdName={householdName}
      defaultCollapsed={defaultCollapsed}
      expandIcon={<PanelLeftOpen aria-hidden className='size-5' />}
      collapseIcon={<PanelLeftClose aria-hidden className='size-5' />}
    >
      {quickLog === null ? null : (
        <div className='px-3 pb-4'>
          <QuickLogLauncher {...quickLog} />
        </div>
      )}
      <nav id='sidebar-nav' aria-label='Primary' className='flex flex-1 flex-col overflow-y-auto px-3 pb-4'>
        <div className='flex flex-1 flex-col gap-6'>
          {SIDEBAR_GROUPS.map((group, index) => (
            <div key={group.label ?? index}>
              {group.label ? <p className={`px-3 pb-1 text-sm text-ink-muted ${COLLAPSED}:hidden`}>{group.label}</p> : null}
              <ul className='flex flex-col gap-0.5'>
                {group.items.map(item => (
                  <li key={item.href}>
                    <SidebarLink item={item} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className='border-t border-line pt-3'>
          <SidebarLink item={SETTINGS} />
        </div>
      </nav>
    </SidebarFrame>
  )
}

function SidebarLink({ item }: { item: NavItem }) {
  const Icon = item.icon
  return (
    <NavLink
      href={item.href}
      label={item.label}
      className='flex h-tap items-center gap-3 rounded-control px-3 text-base focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden group-data-[collapsed=true]/sidebar:justify-center group-data-[collapsed=true]/sidebar:px-0'
      activeClassName='bg-paper font-medium text-ink'
      inactiveClassName='text-ink-muted hover:bg-paper hover:text-ink'
    >
      <Icon aria-hidden className='size-5 shrink-0' />
      <span className='truncate group-data-[collapsed=true]/sidebar:sr-only'>{item.label}</span>
    </NavLink>
  )
}
