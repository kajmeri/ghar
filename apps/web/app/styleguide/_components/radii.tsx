import { radius } from '@ghar/tokens';

const RADIUS_CLASS: Record<keyof typeof radius, string> = {
  card: 'rounded-card',
  control: 'rounded-control',
  pill: 'rounded-pill',
};

export function Radii() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {Object.entries(RADIUS_CLASS).map(([name, className]) => (
        <li
          key={name}
          className={`flex h-24 flex-col justify-end border border-line bg-surface p-3 ${className}`}
        >
          <p className="text-sm font-medium">{name}</p>
          <p className="text-xs text-ink-muted">{radius[name as keyof typeof radius]}px</p>
        </li>
      ))}
      <li className="flex h-24 flex-col justify-end rounded-card border border-line bg-surface p-3 shadow-overlay">
        <p className="text-sm font-medium">overlay</p>
        <p className="text-xs text-ink-muted">The only shadow</p>
      </li>
    </ul>
  );
}
