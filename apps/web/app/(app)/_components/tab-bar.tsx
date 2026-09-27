import { Ellipsis } from 'lucide-react'
import { MoreSheet, MoreSheetLink } from './more-sheet'
import { LOG, MORE_ITEMS, TAB_ITEMS } from './nav'
import { NavLink } from './nav-link'

// Rendered on the server; NavLink and MoreSheet are the only parts that run in the browser.
const TAB_CLASS =
  'flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs active:bg-ink/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-hidden focus-visible:ring-inset'
// The icons render with the idle stroke; the current tab thickens it from CSS.
const TAB_ACTIVE = 'font-medium text-ink [&_svg]:[stroke-width:2.25]'
const TAB_IDLE = 'text-ink-muted'

/** `canLog` puts the quick log at the top of More, for someone who can log something. */
export function TabBar({ canLog }: { canLog: boolean }) {
  const more = canLog ? [LOG, ...MORE_ITEMS] : MORE_ITEMS
  return (
    <nav
      aria-label='Primary'
      className='fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden print:hidden'
    >
      <ul className='grid grid-cols-5'>
        {TAB_ITEMS.map(item => {
          const Icon = item.icon
          return (
            <li key={item.href}>
              <NavLink href={item.href} className={TAB_CLASS} activeClassName={TAB_ACTIVE} inactiveClassName={TAB_IDLE}>
                <Icon aria-hidden className='size-6' strokeWidth={1.75} />
                {item.label}
              </NavLink>
            </li>
          )
        })}
        <li>
          <MoreSheet
            hrefs={more.map(item => item.href)}
            triggerClassName={TAB_CLASS}
            activeClassName={TAB_ACTIVE}
            inactiveClassName={TAB_IDLE}
            triggerIcon={<Ellipsis aria-hidden className='size-6' strokeWidth={1.75} />}
          >
            {more.map(item => {
              const Icon = item.icon
              return (
                <li key={item.href}>
                  <MoreSheetLink href={item.href}>
                    <Icon aria-hidden className='size-5 text-ink-muted' />
                    {item.label}
                  </MoreSheetLink>
                </li>
              )
            })}
          </MoreSheet>
        </li>
      </ul>
    </nav>
  )
}
