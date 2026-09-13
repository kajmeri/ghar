import { Button } from '@/components/ui/button';

const PILLS = [
  { label: 'Under budget', className: 'border-positive text-positive' },
  { label: 'Due this week', className: 'border-caution text-caution' },
  { label: 'Overdue', className: 'border-negative text-negative' },
  { label: 'Draft', className: 'border-line text-ink-muted' },
];

export function Controls() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3">
        <Button type="button">Save changes</Button>
        <Button type="button" variant="outline">
          Cancel
        </Button>
        <Button type="button" variant="ghost">
          Skip for now
        </Button>
        <Button type="button" variant="destructive">
          Delete document
        </Button>
        <Button type="button" disabled>
          Saving
        </Button>
      </div>

      <label className="flex max-w-sm flex-col gap-2">
        <span className="text-sm font-medium">Amount</span>
        <input
          inputMode="decimal"
          placeholder="0.00"
          className="h-tap rounded-control border border-input bg-surface px-3 text-base text-ink placeholder:text-ink-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        />
      </label>

      <ul className="flex flex-wrap gap-2">
        {PILLS.map(({ label, className }) => (
          <li key={label} className={`rounded-pill border px-3 py-1 text-sm ${className}`}>
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
