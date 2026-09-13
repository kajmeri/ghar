import { typeScale, type TypeStep } from '@casa/tokens';

// Literal class names so Tailwind can see them. A new step in tokens.json fails typecheck here.
const TEXT_CLASS: Record<TypeStep, string> = {
  xs: 'text-xs',
  sm: 'text-sm',
  base: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
  '2xl': 'text-2xl',
  '3xl': 'text-3xl',
  '4xl': 'text-4xl',
};

export function TypeScale() {
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {Object.entries(TEXT_CLASS).map(([step, className]) => {
        const { fontSize, lineHeight } = typeScale[step as TypeStep];
        return (
          <li key={step} className="flex items-baseline justify-between gap-4 px-4 py-3">
            <span className={`${className} truncate`}>Water bill due Friday</span>
            <span className="shrink-0 text-xs text-ink-muted">
              {step} · {fontSize}/{lineHeight}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
