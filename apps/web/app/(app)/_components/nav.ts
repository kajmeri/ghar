import {
  BookUser,
  CalendarClock,
  CalendarDays,
  FileText,
  HeartPulse,
  House,
  NotebookPen,
  Plane,
  Receipt,
  Settings,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

const HOME: NavItem = { label: 'Home', href: '/', icon: House }
const MONEY: NavItem = { label: 'Money', href: '/finances', icon: Wallet }
const CALENDAR: NavItem = { label: 'Calendar', href: '/calendar', icon: CalendarDays }
const TRAVEL: NavItem = { label: 'Travel', href: '/travel', icon: Plane }
const DOCUMENTS: NavItem = { label: 'Documents', href: '/documents', icon: FileText }
const RENEWALS: NavItem = { label: 'Renewals', href: '/renewals', icon: CalendarClock }
const HEALTH: NavItem = { label: 'Health', href: '/health', icon: HeartPulse }
const HOUSE: NavItem = { label: 'House', href: '/home', icon: Wrench }
const BILLS: NavItem = { label: 'Bills', href: '/bills', icon: Receipt }
const CONTACTS: NavItem = { label: 'Contacts', href: '/contacts', icon: BookUser }
/** The quick log on its own page, for phones. Only for someone who can log something. */
export const LOG: NavItem = { label: 'Log something', href: '/log', icon: NotebookPen }
export const SETTINGS: NavItem = { label: 'Settings', href: '/settings', icon: Settings }

/** What the navigation offers depends on who is looking: Money and Bills are for owners and adults. */
export interface NavAccess {
  canSeeMoney: boolean
}

/**
 * The phone's bottom bar: four destinations plus More, which opens moreItems. Someone who can't see
 * Money gets House in its place rather than a tab that only says no.
 */
export function tabItems({ canSeeMoney }: NavAccess): NavItem[] {
  return [HOME, canSeeMoney ? MONEY : HOUSE, CALENDAR, TRAVEL]
}

export function moreItems({ canSeeMoney }: NavAccess): NavItem[] {
  return canSeeMoney ? [HOUSE, DOCUMENTS, RENEWALS, HEALTH, CONTACTS, BILLS, SETTINGS] : [DOCUMENTS, RENEWALS, HEALTH, CONTACTS, SETTINGS]
}

/** The desktop sidebar. Settings sits apart at the bottom. */
export function sidebarGroups({ canSeeMoney }: NavAccess): NavGroup[] {
  return [
    { items: [HOME] },
    { label: 'Everyday', items: canSeeMoney ? [MONEY, CALENDAR, TRAVEL] : [CALENDAR, TRAVEL] },
    {
      label: 'Records',
      items: canSeeMoney ? [HOUSE, DOCUMENTS, RENEWALS, HEALTH, CONTACTS, BILLS] : [HOUSE, DOCUMENTS, RENEWALS, HEALTH, CONTACTS],
    },
  ]
}

export { SIDEBAR_COOKIE } from './nav-cookie'
export { isActive } from './nav-match'
