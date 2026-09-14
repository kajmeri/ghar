import {
  CalendarDays,
  FileText,
  House,
  Plane,
  Settings,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
}

export interface NavGroup {
  label?: string;
  items: NavItem[];
}

const HOME: NavItem = { label: 'Home', href: '/', icon: House };
const MONEY: NavItem = { label: 'Money', href: '/finances', icon: Wallet };
const CALENDAR: NavItem = { label: 'Calendar', href: '/calendar', icon: CalendarDays };
const TRAVEL: NavItem = { label: 'Travel', href: '/travel', icon: Plane };
const DOCUMENTS: NavItem = { label: 'Documents', href: '/documents', icon: FileText };
const HOUSE: NavItem = { label: 'House', href: '/home', icon: Wrench };
export const SETTINGS: NavItem = { label: 'Settings', href: '/settings', icon: Settings };

/** The phone's bottom bar. Four destinations plus More, which opens MORE_ITEMS. */
export const TAB_ITEMS: NavItem[] = [HOME, MONEY, CALENDAR, TRAVEL];
export const MORE_ITEMS: NavItem[] = [DOCUMENTS, HOUSE, SETTINGS];

/** The desktop sidebar. Settings sits apart at the bottom. */
export const SIDEBAR_GROUPS: NavGroup[] = [
  { items: [HOME] },
  { label: 'Everyday', items: [MONEY, CALENDAR, TRAVEL] },
  { label: 'Records', items: [DOCUMENTS, HOUSE] },
];

/** Remembers whether the desktop sidebar is collapsed, so the server renders it that way. */
export const SIDEBAR_COOKIE = 'ghar_sidebar';

export function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}
