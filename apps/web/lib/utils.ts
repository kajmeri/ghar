import { radius } from '@casa/tokens';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// Teach tailwind-merge Casa's token names so `rounded-control` and `rounded-card` conflict.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: Object.keys(radius),
      shadow: ['overlay'],
      spacing: ['tap'],
      container: ['content'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
