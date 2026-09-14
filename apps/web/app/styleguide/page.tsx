import { assertCalendarDate, type CalendarDate, formatCalendarDate } from '@ghar/core/dates';
import { formatCents } from '@ghar/core/money';
import { Briefcase, Fuel, type LucideIcon, Plus, ShoppingCart, Utensils, Zap } from 'lucide-react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { Avatar, IconAvatar } from '@/app/(app)/_components/ui/avatar';
import { DataList } from '@/app/(app)/_components/ui/data-list';
import { EmptyState } from '@/app/(app)/_components/ui/empty-state';
import {
  CalendarIllustration,
  ChecklistIllustration,
  DocumentIllustration,
  HouseIllustration,
  LockIllustration,
  PeopleIllustration,
  SuitcaseIllustration,
  WalletIllustration,
} from '@/app/(app)/_components/ui/illustrations';
import { PageHeader } from '@/app/(app)/_components/ui/page-header';
import { ProgressBar } from '@/app/(app)/_components/ui/progress-bar';
import { SectionHeader } from '@/app/(app)/_components/ui/section-header';
import {
  CardSkeleton,
  DataListSkeleton,
  EmptyStateSkeleton,
  PageHeaderSkeleton,
  ProgressBarSkeleton,
  StatGroupSkeleton,
} from '@/app/(app)/_components/ui/skeletons';
import { StatCard, StatGroup } from '@/app/(app)/_components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Amounts } from './_components/amounts';
import { ColorSwatches } from './_components/color-swatches';
import { Controls } from './_components/controls';
import { ConfirmDemo, FieldsDemo, SheetDemo } from './_components/interactive-demos';
import { Radii } from './_components/radii';
import { Spacing } from './_components/spacing';
import { TypeScale } from './_components/type-scale';

export const metadata: Metadata = { title: 'Styleguide', robots: { index: false } };

const SECTIONS = [
  { id: 'foundations', title: 'Foundations' },
  { id: 'headers', title: 'Headers' },
  { id: 'stats', title: 'Stat cards' },
  { id: 'progress', title: 'Progress' },
  { id: 'data-list', title: 'Data list' },
  { id: 'empty-states', title: 'Empty states' },
  { id: 'fields', title: 'Fields' },
  { id: 'overlays', title: 'Overlays' },
  { id: 'skeletons', title: 'Skeletons' },
  { id: 'illustrations', title: 'Illustrations' },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

interface Transaction {
  id: string;
  merchant: string;
  category: string;
  account: string;
  date: CalendarDate;
  cents: number;
  icon: LucideIcon;
}

// Fixed sample data, so the page looks the same every day.
const TRANSACTIONS: Transaction[] = [
  {
    id: 't1',
    merchant: 'Whole Foods Market',
    category: 'Groceries',
    account: 'Sapphire card ···· 4421',
    date: assertCalendarDate('2026-09-12'),
    cents: -8_412,
    icon: ShoppingCart,
  },
  {
    id: 't2',
    merchant: 'Payroll deposit',
    category: 'Income',
    account: 'Joint checking ···· 0917',
    date: assertCalendarDate('2026-09-11'),
    cents: 421_250,
    icon: Briefcase,
  },
  {
    id: 't3',
    merchant: 'Shell',
    category: 'Transport',
    account: 'Sapphire card ···· 4421',
    date: assertCalendarDate('2026-09-10'),
    cents: -5_230,
    icon: Fuel,
  },
  {
    id: 't4',
    merchant: 'City water and power',
    category: 'Utilities',
    account: 'Joint checking ···· 0917',
    date: assertCalendarDate('2026-09-08'),
    cents: -14_806,
    icon: Zap,
  },
  {
    id: 't5',
    merchant: 'Tartine Bakery',
    category: 'Dining out',
    account: 'Gold card ···· 1008',
    date: assertCalendarDate('2026-09-07'),
    cents: -3_675,
    icon: Utensils,
  },
];

const MEMBERS = [
  {
    id: 'm1',
    name: 'Priya Raman',
    email: 'priya@example.com',
    role: 'Owner',
    joined: '2026-01-04',
  },
  { id: 'm2', name: 'Sam Okafor', email: 'sam@example.com', role: 'Adult', joined: '2026-01-06' },
  {
    id: 'm3',
    name: 'Maya Okafor-Raman',
    email: 'maya@example.com',
    role: 'Member',
    joined: '2026-03-21',
  },
].map((member) => ({ ...member, joined: assertCalendarDate(member.joined) }));

const ILLUSTRATIONS = [
  { name: 'Wallet', Illustration: WalletIllustration },
  { name: 'Calendar', Illustration: CalendarIllustration },
  { name: 'Suitcase', Illustration: SuitcaseIllustration },
  { name: 'Document', Illustration: DocumentIllustration },
  { name: 'House', Illustration: HouseIllustration },
  { name: 'People', Illustration: PeopleIllustration },
  { name: 'Lock', Illustration: LockIllustration },
  { name: 'Checklist', Illustration: ChecklistIllustration },
];

export default function StyleguidePage() {
  if (process.env.NODE_ENV === 'production') notFound();

  return (
    <main className="mx-auto w-full max-w-content pt-[max(--spacing(8),env(safe-area-inset-top))] pr-[max(--spacing(4),env(safe-area-inset-right))] pb-[max(--spacing(16),env(safe-area-inset-bottom))] pl-[max(--spacing(4),env(safe-area-inset-left))] md:px-8 md:pt-12">
      <PageHeader
        title="Styleguide"
        description="Every piece Ghar’s screens are built from, all drawn from @ghar/tokens. Tab through to check focus rings. Development only."
      />

      <nav aria-label="Styleguide sections" className="pb-10">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="inline-flex min-h-tap items-center rounded-pill border border-line bg-surface px-4 text-sm transition-colors hover:bg-paper focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                {section.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="divide-y divide-line">
        <Section
          id="foundations"
          description="Tokens from packages/tokens/tokens.json. Color only ever means something about money or state."
        >
          <Group
            title="Color"
            description="Caution fills bars and colors icons, never text: it doesn’t reach 4.5:1 on paper."
          >
            <ColorSwatches />
          </Group>
          <Group title="Type" description="Public Sans, and every figure is tabular.">
            <TypeScale />
          </Group>
          <Group title="Amounts" description="The amount treatment: 600 weight, tight tracking.">
            <Amounts />
          </Group>
          <Group title="Spacing">
            <Spacing />
          </Group>
          <Group
            title="Radii and elevation"
            description="Radius follows hierarchy. One hairline border weight, and shadows only on overlays."
          >
            <Radii />
          </Group>
          <Group
            title="Buttons and pills"
            description="The primary button is ink. Color is for meaning."
          >
            <Controls />
          </Group>
        </Section>

        <Section id="headers">
          <Group
            title="PageHeader"
            description="The page’s one h1, a line of context, its main actions."
          >
            <Frame>
              <PageHeader
                title="Money"
                description="Accounts, spending and budgets"
                action={
                  <Button>
                    <Plus aria-hidden />
                    Add a bill
                  </Button>
                }
              />
            </Frame>
          </Group>
          <Group
            title="SectionHeader"
            description="Level 2 for a section, level 3 for a group inside one."
          >
            <Frame className="flex flex-col gap-4">
              <SectionHeader
                title="Budgets"
                description="September, reset on the 1st"
                action={<Button variant="outline">Edit budgets</Button>}
              />
              <SectionHeader level={3} title="Groceries and dining" />
            </Frame>
          </Group>
        </Section>

        <Section
          id="stats"
          description="Stat groups lay out by the room they have, so the same group works in a sidebar or across the page."
        >
          <Group title="Across the page">
            <SpendingStats />
          </Group>
          <Group title="In a narrow column">
            <div className="max-w-sm">
              <StatGroup>
                <StatCard
                  label="Trips this year"
                  value="4"
                  delta={{ direction: 'up', sentiment: 'neutral', value: '1', label: 'vs 2025' }}
                />
                <StatCard label="Next renewal" value="12 days" />
              </StatGroup>
            </div>
          </Group>
        </Section>

        <Section
          id="progress"
          description="Core decides the status from the figures: under, approaching from 80%, over past 100%."
        >
          <Budgets />
        </Section>

        <Section
          id="data-list"
          description="A real table from md up. Below md each row stacks, with extra columns as label and value pairs."
        >
          <Group
            title="Transactions"
            description="Icon avatars, linked rows, an Account column from lg up."
          >
            <TransactionList rows={TRANSACTIONS} />
          </Group>
          <Group title="People" description="Initials avatars and no trailing figure.">
            <DataList
              label="Household members"
              rows={MEMBERS}
              rowKey={(row) => row.id}
              leading={(row) => <Avatar name={row.name} />}
              primary={{ header: 'Name', cell: (row) => row.name }}
              secondary={(row) => row.email}
              columns={[
                { id: 'role', header: 'Role', cell: (row) => row.role },
                {
                  id: 'joined',
                  header: 'Joined',
                  cell: (row) => formatCalendarDate(row.joined),
                },
              ]}
            />
          </Group>
          <Group title="With no rows" description="The list hands over to its empty state.">
            <TransactionList
              rows={[]}
              empty={
                <EmptyState
                  level={3}
                  title="No transactions this month"
                  description="Connect an account and its transactions show up here as they clear."
                />
              }
            />
          </Group>
        </Section>

        <Section
          id="empty-states"
          description="An illustration, one sentence saying what to do next, and at most one action."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptyState
              level={3}
              illustration={<PeopleIllustration />}
              title="Ghar works best shared"
              description="Invite the people you live with so everyone sees the same bills, plans and reminders."
              action={<Button>Invite someone</Button>}
            />
            <EmptyState
              level={3}
              illustration={<SuitcaseIllustration />}
              title="Plan your next trip"
              description="Add a trip and Ghar keeps its flights and stays together and watches fares for drops."
              action={<Button disabled>Add a trip</Button>}
              hint="Trips arrive in a later update."
            />
            <EmptyState
              level={3}
              illustration={<ChecklistIllustration />}
              title="Nothing needs you today"
              description="Bills, trips and house jobs land here when they need attention."
              action={<Button variant="outline">View household</Button>}
            />
            <EmptyState
              level={3}
              illustration={<LockIllustration />}
              title="Money is for owners and adults"
              description="Ask an owner to change your role if you need to see accounts and budgets."
            />
          </div>
        </Section>

        <Section
          id="fields"
          description="MoneyInput submits integer cents. DateField submits yyyy-MM-dd. Errors show once you leave a field."
        >
          <FieldsDemo />
        </Section>

        <Section
          id="overlays"
          description="The only things that move, and only because you opened them. Reduced motion turns it off."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <Frame className="flex flex-col gap-3">
              <SectionHeader level={3} title="Sheet" className="pb-0" />
              <SheetDemo />
            </Frame>
            <Frame className="flex flex-col gap-3">
              <SectionHeader level={3} title="ConfirmDialog" className="pb-0" />
              <ConfirmDemo />
            </Frame>
          </div>
        </Section>

        <Section
          id="skeletons"
          description="Each one has the exact footprint of what it stands in for, so nothing moves when the page arrives."
        >
          <Pair title="PageHeader" side>
            <Frame>
              <PageHeader title="Travel" description="Trips, bookings and fare alerts" />
            </Frame>
            <Frame>
              <PageHeaderSkeleton />
            </Frame>
          </Pair>
          <Pair title="StatGroup">
            <SpendingStats />
            <StatGroupSkeleton />
          </Pair>
          <Pair title="ProgressBar" side>
            <div className="rounded-card border border-line bg-surface p-4 md:p-5">
              <BudgetBar label="Groceries" spent={41_250} limit={60_000} />
            </div>
            <div className="rounded-card border border-line bg-surface p-4 md:p-5">
              <ProgressBarSkeleton />
            </div>
          </Pair>
          <Pair title="DataList">
            <TransactionList rows={TRANSACTIONS.slice(0, 3)} />
            <DataListSkeleton rows={3} leading columns={2} />
          </Pair>
          <Pair title="EmptyState" side>
            <EmptyState
              level={3}
              illustration={<CalendarIllustration />}
              title="Bring everyone’s plans together"
              description="Connect Google Calendar and each person’s events show up here side by side."
              action={<Button>Connect Google Calendar</Button>}
            />
            <EmptyStateSkeleton />
          </Pair>
          <Pair title="Settings card" side>
            <div className="rounded-card border border-line bg-surface p-4">
              <p className="font-medium">The Raman-Okafor house</p>
              <p className="text-sm text-ink-muted">Members, roles and invitations</p>
            </div>
            <CardSkeleton />
          </Pair>
        </Section>

        <Section
          id="illustrations"
          description="Line drawings in ink-muted, for empty states. They sit on any surface."
        >
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {ILLUSTRATIONS.map(({ name, Illustration }) => (
              <li
                key={name}
                className="flex flex-col items-center gap-2 rounded-card border border-line bg-surface p-4"
              >
                <Illustration />
                <p className="text-sm text-ink-muted">{name}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </main>
  );
}

function Section({
  id,
  description,
  children,
}: {
  id: SectionId;
  description?: string;
  children: ReactNode;
}) {
  const title = SECTIONS.find((section) => section.id === id)?.title ?? id;
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className="scroll-mt-6 py-10 first:pt-0 md:py-12"
    >
      <SectionHeader
        id={`${id}-heading`}
        title={title}
        description={description}
        className="pb-6"
      />
      <div className="flex flex-col gap-10">{children}</div>
    </section>
  );
}

function Group({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <SectionHeader level={3} title={title} description={description} />
      {children}
    </div>
  );
}

/** The real component and its skeleton, next to each other when there's room. */
function Pair({
  title,
  side = false,
  children,
}: {
  title: string;
  side?: boolean;
  children: [ReactNode, ReactNode];
}) {
  const [real, skeleton] = children;
  return (
    <div>
      <SectionHeader level={3} title={title} />
      <div className={cn('grid gap-4', side && 'lg:grid-cols-2')}>
        <div>
          <p className="pb-2 text-sm text-ink-muted">Loaded</p>
          {real}
        </div>
        <div>
          <p className="pb-2 text-sm text-ink-muted">Loading</p>
          {skeleton}
        </div>
      </div>
    </div>
  );
}

/** A plain outline around an example that normally sits straight on the page. */
function Frame({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-card border border-line p-4 md:p-6', className)}>{children}</div>
  );
}

function SpendingStats() {
  return (
    <StatGroup>
      <StatCard
        label="Spent this month"
        value={formatCents(341_250)}
        delta={{
          direction: 'up',
          sentiment: 'negative',
          value: formatCents(21_240),
          label: 'vs August',
        }}
      />
      <StatCard
        label="Income"
        value={formatCents(842_500)}
        delta={{ direction: 'up', sentiment: 'positive', value: '4%', label: 'vs August' }}
      />
      <StatCard
        label="Left in budgets"
        value={formatCents(108_750)}
        delta={{
          direction: 'flat',
          sentiment: 'neutral',
          value: formatCents(0),
          label: 'vs August',
        }}
      />
      <StatCard label="Across all accounts" value={formatCents(1_284_562)} />
    </StatGroup>
  );
}

function Budgets() {
  return (
    <div className="flex flex-col gap-6 rounded-card border border-line bg-surface p-4 md:p-5">
      <BudgetBar label="Groceries" spent={41_250} limit={60_000} />
      <BudgetBar label="Dining out" spent={54_000} limit={60_000} />
      <BudgetBar label="Home supplies" spent={71_280} limit={60_000} />
    </div>
  );
}

function BudgetBar({ label, spent, limit }: { label: string; spent: number; limit: number }) {
  const left = limit - spent;
  return (
    <ProgressBar
      label={label}
      value={spent}
      max={limit}
      valueText={`${formatCents(spent)} of ${formatCents(limit)}`}
      detail={left >= 0 ? `${formatCents(left)} left` : `${formatCents(-left)} over`}
    />
  );
}

function TransactionList({ rows, empty }: { rows: Transaction[]; empty?: ReactNode }) {
  return (
    <DataList
      label="Recent transactions"
      rows={rows}
      rowKey={(row) => row.id}
      leading={(row) => <IconAvatar icon={row.icon} />}
      primary={{ header: 'Transaction', cell: (row) => row.merchant }}
      secondary={(row) => row.category}
      columns={[
        { id: 'date', header: 'Date', cell: (row) => formatCalendarDate(row.date, 'MMM d') },
        { id: 'account', header: 'Account', cell: (row) => row.account, showFrom: 'lg' },
      ]}
      trailing={{
        header: 'Amount',
        cell: (row) => (
          <span className={row.cents > 0 ? 'text-positive' : undefined}>
            {formatCents(row.cents, { signDisplay: 'exceptZero' })}
          </span>
        ),
      }}
      href={() => '#data-list'}
      empty={empty}
    />
  );
}
