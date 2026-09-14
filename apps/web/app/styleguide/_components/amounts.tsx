import { formatCents } from '@ghar/core/money'

// No caution amount: caution is too light to read as text, so it only ever fills or colors an icon.
const AMOUNTS = [
  { label: 'Income this month', cents: 842_500, tone: 'text-positive', sign: 'always' },
  { label: 'Dining out, over budget', cents: -12_840, tone: 'text-negative', sign: 'auto' },
  { label: 'Across all accounts', cents: 1_284_562, tone: 'text-ink', sign: 'auto' },
  { label: 'Pending refund', cents: 4_999, tone: 'text-ink-muted', sign: 'auto' },
] as const

export function Amounts() {
  return (
    <ul className='grid gap-3 sm:grid-cols-2'>
      {AMOUNTS.map(({ label, cents, tone, sign }) => (
        <li key={label} className='rounded-card border border-line bg-surface p-4'>
          <p className='text-sm text-ink-muted'>{label}</p>
          <p className={`amount mt-1 text-3xl ${tone}`}>{formatCents(cents, { signDisplay: sign })}</p>
        </li>
      ))}
    </ul>
  )
}
