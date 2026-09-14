import { space } from '@ghar/tokens';

export function Spacing() {
  return (
    <ul className="flex flex-col gap-2 rounded-card border border-line bg-surface p-4">
      {Object.entries(space).map(([step, px]) => (
        <li key={step} className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-xs text-ink-muted">
            {step} · {px}px
          </span>
          <span
            className="h-2 rounded-pill bg-ink"
            style={{ width: `calc(var(--spacing) * ${step})` }}
          />
        </li>
      ))}
    </ul>
  );
}
