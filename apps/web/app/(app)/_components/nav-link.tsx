'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { isActive } from './nav-match'

/** Whether the desktop sidebar is collapsed, for the links inside it. False everywhere else. */
export const SidebarCollapsedContext = createContext(false)

/**
 * A navigation link that knows whether it's the current page. The only part of the sidebar and
 * the tab bar that needs the browser; the icons and labels around it render on the server.
 */
export function NavLink({
  href,
  label,
  className,
  activeClassName,
  inactiveClassName,
  children,
}: {
  href: string
  /** Shown as a tooltip while the sidebar is collapsed to icons. */
  label?: string
  className: string
  activeClassName: string
  inactiveClassName: string
  children: ReactNode
}) {
  const pathname = usePathname()
  const collapsed = useContext(SidebarCollapsedContext)
  const active = isActive(pathname, href)
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      title={collapsed && label ? label : undefined}
      className={cn(className, active ? activeClassName : inactiveClassName)}
    >
      {children}
    </Link>
  )
}
