import 'server-only'
import { formatCalendarDate, formatInstant, addCalendarDays, type CalendarDate, type TimeZone } from '@ghar/core/dates'
import {
  budgetPaceSentence,
  DIGEST_SECTION_TITLES,
  digestSubject,
  ONE_TAP_LINK_TTL_HOURS,
  type Digest,
  type DigestBill,
  type DigestBlock,
  type DigestCalendarItem,
  type DigestTransaction,
  type DigestUpkeepItem,
} from '@ghar/core/digest'
import { formatCents, type Cents } from '@ghar/core/money'
import { colors } from '@ghar/tokens'
import { Body, Column, Container, Head, Hr, Html, Link, Preview, Row, Section, Text } from '@react-email/components'
import { render } from '@react-email/render'
import type { CSSProperties, ReactNode } from 'react'
import { manualAccountHref, NET_WORTH_PATH } from '@/lib/networth/display'
import type { EmailMessage } from '@/lib/providers/email'

// The daily digest email. Plain on purpose: a wordmark in type, one column, hairlines between
// sections, color only where it says something about money or lateness. Every text color is paired
// with a background, so a client that recolors for dark mode recolors both. Clients that honor
// prefers-color-scheme get the palette swapped, ink for paper. The text part says the same things.

export interface DigestLinks {
  /** One-tap "change category" links by transaction id. */
  categorize: ReadonlyMap<string, string>
  /** One-tap "mark paid" links by bill id. */
  markPaid: ReadonlyMap<string, string>
}

export interface DigestEmailInput {
  to: string
  recipientName: string | null
  householdName: string
  timeZone: TimeZone
  currency: string
  digest: Digest
  /** Origin, without a trailing slash. */
  appUrl: string
  links: DigestLinks
  /** Sent by hand from settings rather than on schedule. */
  preview: boolean
}

export async function digestEmail(input: DigestEmailInput): Promise<EmailMessage> {
  const view = buildView(input)
  const subject = input.preview ? `Preview: ${digestSubject(input.digest)}` : digestSubject(input.digest)
  const html = await render(<DigestDocument view={view} />)
  return { to: input.to, subject, text: plainText(view), html }
}

// ---------------------------------------------------------------------------------------------
// What the email says, once, for both parts

interface Line {
  primary: string
  /** Right-aligned: an amount or a time. */
  figure?: string
  secondary?: string
  /** Late or cheaper: gets its meaning's color. */
  tone?: 'negative' | 'positive'
  action?: { label: string; url: string }
}

interface SectionView {
  title: string
  intro?: string
  groups: { heading?: string; lines: Line[] }[]
  /** A closing link, like "See all 12". */
  footer?: { label: string; url: string }
}

interface View {
  heading: string
  dateLine: string
  preview: boolean
  hasOneTap: boolean
  sections: SectionView[]
  settingsUrl: string
  appUrl: string
}

function buildView(input: DigestEmailInput): View {
  const money = (cents: Cents) => formatCents(cents, { currency: input.currency })
  const sections = input.digest.blocks.map(block => sectionView(block, input, money))
  const firstName = input.recipientName?.trim().split(/\s+/)[0]
  return {
    // People pick their own hour, so no "good morning".
    heading: firstName ? `Here’s your day, ${firstName}.` : 'Here’s your day.',
    dateLine: `${input.householdName} · ${formatCalendarDate(input.digest.date, 'EEEE, MMMM d')}`,
    preview: input.preview,
    hasOneTap: input.links.categorize.size > 0 || input.links.markPaid.size > 0,
    sections,
    settingsUrl: `${input.appUrl}/settings/digest`,
    appUrl: input.appUrl,
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function sectionView(block: DigestBlock, input: DigestEmailInput, money: (cents: Cents) => string): SectionView {
  const title = DIGEST_SECTION_TITLES[block.section]
  const { appUrl, links } = input
  const finances = `${appUrl}/finances`
  const more = (count: number, noun: string, url: string) =>
    count > 0 ? { label: `And ${plural(count, noun, `${noun}s`)} more in Ghar`, url } : undefined

  switch (block.section) {
    case 'auto_categorized':
      return {
        title,
        intro: 'Filed automatically. Fix any that landed in the wrong place.',
        groups: [{ lines: block.transactions.map(transaction => transactionLine(transaction, money, links.categorize.get(transaction.id), 'Change')) }],
        footer: more(block.more, 'transaction', finances),
      }
    case 'needs_review':
      return {
        title,
        intro: `${plural(block.count, 'transaction is', 'transactions are')} waiting for a category.`,
        groups: [{ lines: block.transactions.map(transaction => transactionLine(transaction, money, links.categorize.get(transaction.id), 'Choose')) }],
        footer: more(block.more, 'transaction', finances),
      }
    case 'budget': {
      const { budget } = block
      const over = budget.remainingCents < 0
      return {
        title,
        intro: `${budgetPaceSentence(budget.pace)} ${Math.round(budget.elapsedShare * 100)}% of ${formatCalendarDate(budget.periodStart, 'MMMM')} has gone by.`,
        groups: [
          {
            lines: [
              { primary: 'Spent', figure: money(budget.spentCents) },
              { primary: 'Planned', figure: money(budget.availableCents) },
              {
                primary: over ? 'Over plan' : 'Left',
                figure: money(Math.abs(budget.remainingCents)),
                tone: over ? 'negative' : budget.pace === 'over_pace' ? undefined : 'positive',
              },
            ],
          },
        ],
        footer: { label: 'See the budget', url: finances },
      }
    }
    case 'bills':
      return {
        title,
        groups: [{ lines: block.bills.map(bill => billLine(bill, input, money)) }],
        footer: more(block.more, 'bill', `${appUrl}/bills`) ?? { label: 'See all bills', url: `${appUrl}/bills` },
      }
    case 'manual_values':
      // Names and dates, never a value: whoever reads this over a shoulder learns nothing about money.
      return {
        title,
        intro: 'Net worth keeps using the last value you entered until you add a new one.',
        groups: [
          {
            lines: block.accounts.map(account => ({
              primary: `Your ${account.name} value is ${plural(account.ageMonths, 'month', 'months')} old`,
              secondary: `Last updated ${formatCalendarDate(account.latestValueOn, 'MMM d, yyyy')}`,
              action: { label: 'Add a new value', url: `${appUrl}${manualAccountHref(account.accountId)}` },
            })),
          },
        ],
        footer: more(block.more, 'account', `${appUrl}${NET_WORTH_PATH}`),
      }
    case 'upkeep':
      return {
        title,
        groups: [{ lines: block.items.map(item => upkeepLine(item, input)) }],
        footer: more(block.more, 'item', `${appUrl}/home`),
      }
    case 'price_drops':
      return {
        title,
        intro: 'Verified prices below what you paid, on bookings whose rules let you claim the difference.',
        groups: [
          {
            lines: block.drops.map(drop => {
              const price = (cents: Cents) => formatCents(cents, { currency: drop.currency })
              return {
                primary: drop.title,
                figure: price(drop.priceCents),
                secondary: `${price(-drop.deltaCents)} less than you paid`,
                tone: 'positive' as const,
                action: { label: 'See what to do', url: `${appUrl}/travel/bookings/${drop.bookingId}` },
              }
            }),
          },
        ],
        footer: more(block.more, 'booking', `${appUrl}/travel/bookings`),
      }
    case 'calendar':
      return {
        title,
        groups: block.days.map(day => ({
          heading: dayHeading(day.date, input.digest.date),
          lines: day.items.map(item => calendarLine(item, input.timeZone)),
        })),
        footer: { label: 'Open the calendar', url: `${appUrl}/calendar` },
      }
  }
}

function transactionLine(transaction: DigestTransaction, money: (cents: Cents) => string, link: string | undefined, verb: string): Line {
  const date = formatCalendarDate(transaction.date, 'MMM d')
  return {
    primary: transaction.description,
    figure: money(transaction.amountCents),
    secondary: transaction.categoryName ? `${transaction.categoryName} · ${date}` : `No category · ${date}`,
    tone: transaction.amountCents > 0 ? 'positive' : undefined,
    action: link ? { label: `${verb} category`, url: link } : undefined,
  }
}

function billLine(bill: DigestBill, input: DigestEmailInput, money: (cents: Cents) => string): Line {
  const due = dueWords(bill.dueOn, input.digest.date)
  const link = input.links.markPaid.get(bill.id)
  return {
    primary: bill.name,
    figure: bill.amountCents === null ? undefined : money(bill.amountCents),
    secondary: [bill.overdue ? `Late, was due ${formatCalendarDate(bill.dueOn, 'MMM d')}` : `Due ${due}`, bill.autopay ? 'Autopay' : null]
      .filter(Boolean)
      .join(' · '),
    tone: bill.overdue ? 'negative' : undefined,
    action: link ? { label: 'Mark paid', url: link } : { label: 'Open bill', url: `${input.appUrl}/bills/${bill.id}` },
  }
}

function upkeepLine(item: DigestUpkeepItem, input: DigestEmailInput): Line {
  const when = dueWords(item.dueOn, input.digest.date)
  const { appUrl } = input
  switch (item.kind) {
    case 'maintenance':
      return {
        primary: item.title,
        secondary: item.overdue ? `Overdue since ${formatCalendarDate(item.dueOn, 'MMM d')}` : `Due ${when}`,
        tone: item.overdue ? 'negative' : undefined,
        action: { label: 'Open task', url: `${appUrl}/home/maintenance/${item.id}` },
      }
    case 'document':
      return { primary: item.title, secondary: `Expires ${when}`, action: { label: 'Open document', url: `${appUrl}/documents/${item.id}` } }
    case 'warranty':
      return { primary: item.title, secondary: `Ends ${when}`, action: { label: 'Open item', url: `${appUrl}/home/assets/${item.id}` } }
  }
}

function calendarLine(item: DigestCalendarItem, timeZone: TimeZone): Line {
  return {
    primary: item.title,
    figure: item.allDay ? 'All day' : formatInstant(item.startsAt, timeZone, { timeStyle: 'short' }),
    secondary: item.location ?? undefined,
  }
}

/** "today", "tomorrow", "Thu, Sep 17". */
function dueWords(date: CalendarDate, today: CalendarDate): string {
  if (date === today) return 'today'
  if (date === addCalendarDays(today, 1)) return 'tomorrow'
  return formatCalendarDate(date, 'EEE, MMM d')
}

function dayHeading(date: CalendarDate, today: CalendarDate): string {
  return `${date === today ? 'Today' : 'Tomorrow'}, ${formatCalendarDate(date, 'EEE, MMM d')}`
}

function footerLines(view: View): string[] {
  const lines = []
  if (view.hasOneTap) {
    lines.push(
      `Links that change something work once and for ${ONE_TAP_LINK_TTL_HOURS / 24} days, without signing in. Anyone with this email can use them, so don’t forward it.`
    )
  }
  lines.push('You get this because the daily email is on for your account.')
  return lines
}

// ---------------------------------------------------------------------------------------------
// Plain text

function plainText(view: View): string {
  const out: string[] = ['Ghar', view.dateLine, '']
  if (view.preview) out.push('This is a preview you sent yourself. Its links work.', '')
  out.push(view.heading, '')
  for (const section of view.sections) {
    out.push(section.title, '-'.repeat(section.title.length))
    if (section.intro) out.push(section.intro)
    for (const group of section.groups) {
      if (group.heading) out.push('', group.heading)
      for (const line of group.lines) {
        out.push(`- ${line.primary}${line.figure ? `: ${line.figure}` : ''}`)
        if (line.secondary) out.push(`  ${line.secondary}`)
        if (line.action) out.push(`  ${line.action.label}: ${line.action.url}`)
      }
    }
    if (section.footer) out.push(`${section.footer.label}: ${section.footer.url}`)
    out.push('')
  }
  out.push(...footerLines(view), `Change what’s in it, when it comes, or turn it off: ${view.settingsUrl}`)
  return out.join('\n')
}

// ---------------------------------------------------------------------------------------------
// HTML

const FONT = "'Public Sans', ui-sans-serif, system-ui, sans-serif"
const muted: CSSProperties = { color: colors.inkMuted }
const small: CSSProperties = { fontSize: '14px', lineHeight: '20px' }
const figures: CSSProperties = { fontVariantNumeric: 'tabular-nums' }
const toneColor = { negative: colors.negative, positive: colors.positive } as const

// Swapped for clients that honor prefers-color-scheme. Tone colors fall back to the text color
// there, because the light palette's greens and reds are too dark to read on ink.
const DARK_MODE_CSS = `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  .g-page, .g-card { background-color: ${colors.ink} !important; }
  .g-text, .g-tone, .g-link { color: ${colors.paper} !important; }
  .g-muted { color: ${colors.line} !important; }
  .g-rule { border-color: ${colors.inkMuted} !important; }
}
`

function DigestDocument({ view }: { view: View }) {
  return (
    <Html lang='en' dir='ltr'>
      <Head>
        <meta name='color-scheme' content='light dark' />
        <meta name='supported-color-schemes' content='light dark' />
        <style>{DARK_MODE_CSS}</style>
      </Head>
      <Preview>{previewText(view)}</Preview>
      {/* Body copies its style onto an inner cell that can't take a class, so the padding lives on the
          container, where dark mode can reach its background. */}
      <Body className='g-page' style={{ margin: 0, backgroundColor: colors.paper, fontFamily: FONT }}>
        <Container className='g-card' style={{ maxWidth: '560px', padding: '24px 16px', backgroundColor: colors.paper }}>
          <Text className='g-text' style={{ margin: 0, color: colors.ink, fontSize: '20px', lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.02em' }}>
            Ghar
          </Text>
          <Text className='g-muted' style={{ margin: '0 0 24px', ...small, ...muted }}>
            {view.dateLine}
          </Text>
          {view.preview ? (
            <Text className='g-muted g-rule' style={{ margin: '0 0 24px', padding: '8px 12px', border: `1px solid ${colors.line}`, borderRadius: '8px', ...small, ...muted }}>
              This is a preview you sent yourself. Its links work, so tap only what you mean to.
            </Text>
          ) : null}
          <Text className='g-text' style={{ margin: '0 0 8px', color: colors.ink, fontSize: '16px', lineHeight: '24px' }}>
            {view.heading}
          </Text>
          {view.sections.map(section => (
            <DigestSection key={section.title} section={section} />
          ))}
          <Hr className='g-rule' style={{ margin: '24px 0 16px', borderColor: colors.line }} />
          {footerLines(view).map(line => (
            <Text key={line} className='g-muted' style={{ margin: '0 0 8px', ...small, ...muted }}>
              {line}
            </Text>
          ))}
          <Text className='g-muted' style={{ margin: 0, ...small, ...muted }}>
            <TextLink href={view.settingsUrl}>Change what’s in it, when it comes, or turn it off</TextLink>
          </Text>
        </Container>
      </Body>
    </Html>
  )
}

function DigestSection({ section }: { section: SectionView }) {
  return (
    <Section style={{ margin: 0 }}>
      <Hr className='g-rule' style={{ margin: '24px 0 16px', borderColor: colors.line }} />
      <Text className='g-text' style={{ margin: '0 0 4px', color: colors.ink, fontSize: '18px', lineHeight: '28px', fontWeight: 600 }}>
        {section.title}
      </Text>
      {section.intro ? (
        <Text className='g-muted' style={{ margin: '0 0 8px', ...small, ...muted }}>
          {section.intro}
        </Text>
      ) : null}
      {section.groups.map((group, index) => (
        <Section key={group.heading ?? index} style={{ margin: 0 }}>
          {group.heading ? (
            <Text className='g-text' style={{ margin: '12px 0 0', color: colors.ink, ...small, fontWeight: 600 }}>
              {group.heading}
            </Text>
          ) : null}
          {group.lines.map((line, lineIndex) => (
            <LineRow key={`${line.primary}-${lineIndex}`} line={line} />
          ))}
        </Section>
      ))}
      {section.footer ? (
        <Text className='g-text' style={{ margin: '12px 0 0', color: colors.ink, ...small }}>
          <TextLink href={section.footer.url}>{section.footer.label}</TextLink>
        </Text>
      ) : null}
    </Section>
  )
}

function LineRow({ line }: { line: Line }) {
  const tone = line.tone ? toneColor[line.tone] : colors.ink
  return (
    <Row style={{ margin: 0 }}>
      <Column style={{ padding: '8px 12px 0 0', verticalAlign: 'top' }}>
        <Text className='g-text' style={{ margin: 0, color: colors.ink, fontSize: '16px', lineHeight: '24px' }}>
          {line.primary}
        </Text>
        {line.secondary ? (
          <Text className={line.tone === 'negative' ? 'g-tone' : 'g-muted'} style={{ margin: 0, ...small, color: line.tone === 'negative' ? colors.negative : colors.inkMuted }}>
            {line.secondary}
          </Text>
        ) : null}
        {line.action ? (
          <Text className='g-text' style={{ margin: 0, color: colors.ink, ...small }}>
            <TextLink href={line.action.url}>{line.action.label}</TextLink>
          </Text>
        ) : null}
      </Column>
      {line.figure ? (
        <Column align='right' style={{ padding: '8px 0 0', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
          <Text className={line.tone ? 'g-tone' : 'g-text'} style={{ margin: 0, color: tone, fontSize: '16px', lineHeight: '24px', fontWeight: 500, ...figures }}>
            {line.figure}
          </Text>
        </Column>
      ) : null}
    </Row>
  )
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link className='g-link' href={href} style={{ color: colors.ink, textDecoration: 'underline' }}>
      {children}
    </Link>
  )
}

/** The inbox's one-line summary: the first thing that needs doing, else the first section. */
function previewText(view: View): string {
  return view.sections
    .slice(0, 3)
    .map(section => section.title)
    .join(' · ')
}
