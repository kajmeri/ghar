import { formatCents } from '@casa/core/money';

const AMOUNTS = [
  { label: 'Income this month', cents: 842_500, tone: 'text-positive', sign: 'always' },
  { label: 'Groceries left, 88% spent', cents: 6_150, tone: 'text-caution', sign: 'auto' },
  { label: 'Dining out, over budget', cents: -12_840, tone: 'text-negative', sign: 'auto' },
  { label: 'Across all accounts', cents: 1_284_562, tone: 'text-ink', sign: 'auto' },
] as const;

export function Amounts() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {AMOUNTS.map(({ label, cents, tone, sign }) => (
        <li key={label} className="rounded-card border border-line bg-surface p-4">
          <p className="text-sm text-ink-muted">{label}</p>
          <p className={`amount mt-1 text-3xl ${tone}`}>
            {formatCents(cents, { signDisplay: sign })}
          </p>
        </li>
      ))}
    </ul>
  );
}
