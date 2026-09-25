import { can, type HouseholdRole, type Permission } from './auth/permissions'
import { addCalendarDays, formatCalendarDate, wallClockTimeInTimeZone, type CalendarDate, type TimeZone } from './dates'
import type { BudgetPace } from './finances/budget'
import type { ManualValueReminder } from './finances/networth'
import { EXPIRY_SUBJECT_KINDS, type ExpirySubjectKind } from './expiries'
import type { Cents } from './money'

// The daily email, one per person: what the money did yesterday and what's coming up. Pure: the web
// app gathers the rows as that person, and this decides what is worth saying and in what order. A
// section with nothing to say is left out, and a digest with no sections isn't sent.

/** In the order the email shows them. */
export const DIGEST_SECTIONS = ['auto_categorized', 'needs_review', 'budget', 'bills', 'manual_values', 'upkeep', 'price_drops', 'calendar'] as const
export type DigestSection = (typeof DIGEST_SECTIONS)[number]

export const DIGEST_SECTION_TITLES: Record<DigestSection, string> = {
  auto_categorized: 'Sorted yesterday',
  needs_review: 'Needs a category',
  budget: 'Spending this month',
  bills: 'Bills due this week',
  manual_values: 'Values to update',
  upkeep: 'Coming up at home',
  price_drops: 'Price drops',
  calendar: 'Today and tomorrow',
}

/** What each section sends, for the settings page. */
export const DIGEST_SECTION_DESCRIPTIONS: Record<DigestSection, string> = {
  auto_categorized: 'Transactions filed automatically yesterday, each with a link to fix it.',
  needs_review: 'Transactions still waiting for a category.',
  budget: 'Spent against the plan, and whether that’s ahead of the month.',
  bills: 'Unpaid bills due in the next 7 days, and any that are late.',
  manual_values: 'Accounts you track by hand, like a home estimate, that are past their reminder. Dates only, never amounts.',
  upkeep: 'Maintenance, checkups and refills coming due, and documents, warranties or renewals running out.',
  price_drops: 'Bookings that got cheaper since yesterday.',
  calendar: 'Events and trips today and tomorrow.',
}

/** What a person needs to be sent a section. Their settings can't add one their role can't see. */
export const DIGEST_SECTION_PERMISSIONS: Record<DigestSection, Permission> = {
  auto_categorized: 'finances.view',
  needs_review: 'finances.view',
  budget: 'finances.view',
  bills: 'finances.view',
  // Net worth is finance data. The section names accounts and dates, but it stays with the money.
  manual_values: 'finances.view',
  upkeep: 'home.view',
  price_drops: 'travel.view',
  calendar: 'calendar.view',
}

export const DEFAULT_DIGEST_SEND_HOUR = 7
/** A digest goes out at the first run within this many hours of the chosen hour, and never after midnight. */
export const DIGEST_SEND_WINDOW_HOURS = 3
/** Unpaid bills due from today through this many days ahead. */
export const DIGEST_BILL_DAYS = 7
/** Maintenance due from today through this many days ahead, and anything overdue. */
export const DIGEST_MAINTENANCE_DAYS = 7
/** Documents and warranties running out from today through this many days ahead. */
export const DIGEST_EXPIRY_DAYS = 30
/** The longest list a section shows. The rest are counted. */
export const DIGEST_LIST_LIMIT = 8

export interface DigestPreferences {
  enabled: boolean
  sections: readonly DigestSection[]
  /** 0 to 23, in the household's zone. */
  sendHour: number
}

/** Everyone gets every section they can see at 7am until they change it. */
export const DEFAULT_DIGEST_PREFERENCES: DigestPreferences = {
  enabled: true,
  sections: DIGEST_SECTIONS,
  sendHour: DEFAULT_DIGEST_SEND_HOUR,
}

export function isDigestSection(value: string): value is DigestSection {
  return (DIGEST_SECTIONS as readonly string[]).includes(value)
}

/** The sections a person is sent: the ones they chose that their role can see, in the email's order. */
export function digestSectionsFor(role: HouseholdRole, chosen: readonly DigestSection[]): DigestSection[] {
  return DIGEST_SECTIONS.filter(section => chosen.includes(section) && can(role, DIGEST_SECTION_PERMISSIONS[section]))
}

export function hourInTimeZone(instant: Date, timeZone: TimeZone): number {
  return Number(wallClockTimeInTimeZone(instant, timeZone).slice(0, 2))
}

/**
 * Whether a person's digest is due at `now`: from their hour for DIGEST_SEND_WINDOW_HOURS, cut off
 * at midnight. A run that misses the hour still sends, and a late one never sends a day's digest on
 * the next day. Whether it already went out today is the caller's to check.
 */
export function isDigestDue(preferences: Pick<DigestPreferences, 'enabled' | 'sendHour'>, now: Date, timeZone: TimeZone): boolean {
  if (!preferences.enabled) return false
  const hour = hourInTimeZone(now, timeZone)
  return hour >= preferences.sendHour && hour < Math.min(preferences.sendHour + DIGEST_SEND_WINDOW_HOURS, 24)
}

// ---------------------------------------------------------------------------------------------
// What goes in

export interface DigestTransaction {
  id: string
  date: CalendarDate
  description: string
  /** Negative is money out. */
  amountCents: Cents
  categoryName: string | null
}

export interface DigestBudget {
  periodStart: CalendarDate
  availableCents: Cents
  spentCents: Cents
  /** Negative when overspent. */
  remainingCents: Cents
  pace: BudgetPace
  /** How much of the month has gone by, 0 to 1. */
  elapsedShare: number
}

export interface DigestBill {
  id: string
  name: string
  dueOn: CalendarDate
  /** The usual amount. Null for a bill that varies with no amount set. */
  amountCents: Cents | null
  autopay: boolean
  overdue: boolean
}

export interface DigestUpkeepItem {
  kind: 'maintenance' | 'document' | 'warranty' | 'renewal' | 'health'
  /** For health, the schedule's id, or the medicine's for a refill. */
  id: string
  title: string
  /** When the job is due, or the day it runs out. */
  dueOn: CalendarDate
  overdue: boolean
  /** A renewal that renews on its own: the day it renews, not a deadline. */
  autoRenews?: boolean
  /** For health: whose checkup or medicine it is, so the link opens their page. */
  personId?: string
}

export interface DigestPriceDrop {
  bookingId: string
  title: string
  priceCents: Cents
  /** Negative: how far below what was paid. */
  deltaCents: Cents
  currency: string
}

export interface DigestCalendarItem {
  id: string
  title: string
  location: string | null
  allDay: boolean
  startsAt: Date
  /** The day it shows under. */
  date: CalendarDate
}

export interface DigestInput {
  today: CalendarDate
  /** Already narrowed to what this person can see. See digestSectionsFor. */
  sections: readonly DigestSection[]
  autoCategorized: readonly DigestTransaction[]
  review: { count: number; transactions: readonly DigestTransaction[] }
  budget: DigestBudget | null
  bills: readonly DigestBill[]
  /** Manual accounts past their reminder cadence. See manualValueReminders. Never a figure. */
  manualValues: readonly ManualValueReminder[]
  upkeep: readonly DigestUpkeepItem[]
  priceDrops: readonly DigestPriceDrop[]
  calendar: readonly DigestCalendarItem[]
}

// ---------------------------------------------------------------------------------------------
// What comes out

export type DigestBlock =
  | { section: 'auto_categorized'; transactions: DigestTransaction[]; more: number }
  | { section: 'needs_review'; count: number; transactions: DigestTransaction[]; more: number }
  | { section: 'budget'; budget: DigestBudget }
  | { section: 'bills'; bills: DigestBill[]; more: number }
  | { section: 'manual_values'; accounts: ManualValueReminder[]; more: number }
  | { section: 'upkeep'; items: DigestUpkeepItem[]; more: number }
  | { section: 'price_drops'; drops: DigestPriceDrop[]; more: number }
  | { section: 'calendar'; days: { date: CalendarDate; items: DigestCalendarItem[] }[] }

export interface Digest {
  date: CalendarDate
  blocks: DigestBlock[]
}

function capped<T>(items: readonly T[]): { list: T[]; more: number } {
  return { list: items.slice(0, DIGEST_LIST_LIMIT), more: Math.max(items.length - DIGEST_LIST_LIMIT, 0) }
}

const lateFirst = (a: { overdue: boolean }, b: { overdue: boolean }) => Number(b.overdue) - Number(a.overdue)

function block(section: DigestSection, input: DigestInput): DigestBlock | null {
  switch (section) {
    case 'auto_categorized': {
      if (input.autoCategorized.length === 0) return null
      const { list, more } = capped(
        input.autoCategorized.toSorted((a, b) => b.date.localeCompare(a.date) || Math.abs(b.amountCents) - Math.abs(a.amountCents))
      )
      return { section, transactions: list, more }
    }
    case 'needs_review': {
      if (input.review.count === 0) return null
      const transactions = input.review.transactions.slice(0, DIGEST_LIST_LIMIT)
      return { section, count: input.review.count, transactions, more: Math.max(input.review.count - transactions.length, 0) }
    }
    case 'budget':
      return input.budget !== null && input.budget.availableCents > 0 ? { section, budget: input.budget } : null
    case 'bills': {
      if (input.bills.length === 0) return null
      const { list, more } = capped(input.bills.toSorted((a, b) => lateFirst(a, b) || a.dueOn.localeCompare(b.dueOn) || a.name.localeCompare(b.name)))
      return { section, bills: list, more }
    }
    case 'manual_values': {
      if (input.manualValues.length === 0) return null
      const { list, more } = capped(input.manualValues.toSorted((a, b) => a.latestValueOn.localeCompare(b.latestValueOn) || a.name.localeCompare(b.name)))
      return { section, accounts: list, more }
    }
    case 'upkeep': {
      if (input.upkeep.length === 0) return null
      const { list, more } = capped(input.upkeep.toSorted((a, b) => lateFirst(a, b) || a.dueOn.localeCompare(b.dueOn) || a.title.localeCompare(b.title)))
      return { section, items: list, more }
    }
    case 'price_drops': {
      if (input.priceDrops.length === 0) return null
      const { list, more } = capped(input.priceDrops.toSorted((a, b) => a.deltaCents - b.deltaCents))
      return { section, drops: list, more }
    }
    case 'calendar': {
      const days = [input.today, addCalendarDays(input.today, 1)]
        .map(date => ({
          date,
          items: input.calendar
            .filter(item => item.date === date)
            .toSorted((a, b) => Number(b.allDay) - Number(a.allDay) || a.startsAt.getTime() - b.startsAt.getTime() || a.title.localeCompare(b.title))
            .slice(0, DIGEST_LIST_LIMIT),
        }))
        .filter(day => day.items.length > 0)
      return days.length === 0 ? null : { section, days }
    }
  }
}

/** The digest for one person, or null when no section has anything to say. */
export function assembleDigest(input: DigestInput): Digest | null {
  const blocks = DIGEST_SECTIONS.filter(section => input.sections.includes(section)).flatMap(section => block(section, input) ?? [])
  return blocks.length === 0 ? null : { date: input.today, blocks }
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** "Tue, Sep 15: 1 bill late, 4 to categorize". The date alone when nothing needs doing. */
export function digestSubject(digest: Digest): string {
  const date = formatCalendarDate(digest.date, 'EEE, MMM d')
  const needs: string[] = []
  for (const item of digest.blocks) {
    if (item.section === 'bills') {
      const late = item.bills.filter(bill => bill.overdue).length
      needs.push(late > 0 ? count(late, 'bill late', 'bills late') : count(item.bills.length + item.more, 'bill due', 'bills due'))
    }
    if (item.section === 'needs_review') needs.push(`${item.count} to categorize`)
    if (item.section === 'price_drops') needs.push(count(item.drops.length + item.more, 'price drop', 'price drops'))
  }
  return needs.length === 0 ? `Your day at home, ${date}` : `${date}: ${needs.join(', ')}`
}

/** How spending compares with the month, in a sentence. */
export function budgetPaceSentence(pace: BudgetPace): string {
  switch (pace) {
    case 'over_pace':
      return 'Spending is ahead of the month.'
    case 'on_pace':
      return 'Spending is on pace for the month.'
    case 'under_pace':
      return 'Spending is behind the month, with room to spare.'
  }
}

// ---------------------------------------------------------------------------------------------
// One-tap links

/**
 * What a link in the digest can do without signing in. Each link does one of these to one thing,
 * once, before it expires. Saying something won't be renewed is one action per kind of thing, so the
 * signed link names the kind as well as the id.
 */
export const ONE_TAP_ACTIONS = [
  'categorize_transaction',
  'mark_bill_paid',
  'not_renewing_document',
  'not_renewing_warranty',
  'not_renewing_renewal',
] as const
export type OneTapAction = (typeof ONE_TAP_ACTIONS)[number]

/** "Not renewing" for each kind of thing that runs out. */
export const NOT_RENEWING_ACTIONS = {
  document: 'not_renewing_document',
  warranty: 'not_renewing_warranty',
  renewal: 'not_renewing_renewal',
} as const satisfies Record<ExpirySubjectKind, OneTapAction>

/** The kind of thing a "not renewing" link is about. Null for any other action. */
export function notRenewingKind(action: OneTapAction): ExpirySubjectKind | null {
  for (const kind of EXPIRY_SUBJECT_KINDS) if (NOT_RENEWING_ACTIONS[kind] === action) return kind
  return null
}

/**
 * Actions that act on one date: the due date a bill is marked paid for, or the expiry date someone
 * isn't renewing. A link for one of these carries the date, and does nothing once it has moved on.
 */
export function oneTapActionHasDate(action: OneTapAction): boolean {
  return action === 'mark_bill_paid' || notRenewingKind(action) !== null
}

/** What the person a link was sent to still has to be allowed to do when they use it. */
export const ONE_TAP_PERMISSIONS: Record<OneTapAction, Permission> = {
  categorize_transaction: 'finances.manage',
  mark_bill_paid: 'finances.manage',
  not_renewing_document: 'documents.manage',
  not_renewing_warranty: 'home.manage',
  not_renewing_renewal: 'documents.manage',
}

/** Long enough to cover a weekend away from email. */
export const ONE_TAP_LINK_TTL_HOURS = 72
