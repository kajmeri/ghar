import { BookUser, CalendarClock, CalendarDays, FileText, House, Plane, Receipt, Settings, Wallet, Wrench, type LucideIcon } from 'lucide-react'

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
const HOUSE: NavItem = { label: 'House', href: '/home', icon: Wrench }
const BILLS: NavItem = { label: 'Bills', href: '/bills', icon: Receipt }
const CONTACTS: NavItem = { label: 'Contacts', href: '/contacts', icon: BookUser }
export const SETTINGS: NavItem = { label: 'Settings', href: '/settings', icon: Settings }

/** The phone's bottom bar. Four destinations plus More, which opens MORE_ITEMS. */
export const TAB_ITEMS: NavItem[] = [HOME, MONEY, CALENDAR, TRAVEL]
export const MORE_ITEMS: NavItem[] = [HOUSE, DOCUMENTS, RENEWALS, CONTACTS, BILLS, SETTINGS]

/** The desktop sidebar. Settings sits apart at the bottom. */
export const SIDEBAR_GROUPS: NavGroup[] = [
  { items: [HOME] },
  { label: 'Everyday', items: [MONEY, CALENDAR, TRAVEL] },
  { label: 'Records', items: [HOUSE, DOCUMENTS, RENEWALS, CONTACTS, BILLS] },
]

export { SIDEBAR_COOKIE } from './nav-cookie'
export { isActive } from './nav-match'
