'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Five destinations, the most a bottom tab bar can hold and still be tappable.
 *
 * Travel is the one that exists. The rest are here because the shape of the app is a
 * decision, not an accident, and a bar that grows an item at a time would be relaid out
 * five times. They are inert and say so rather than linking somewhere empty.
 */
const DESTINATIONS = [
  { href: '/home', label: 'Home', icon: HomeIcon, built: false },
  { href: '/finances', label: 'Money', icon: MoneyIcon, built: false },
  { href: '/calendar', label: 'Calendar', icon: CalendarIcon, built: false },
  { href: '/travel', label: 'Travel', icon: TravelIcon, built: true },
  { href: '/documents', label: 'Docs', icon: DocsIcon, built: false },
] as const;

export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Sections"
      className={cn(
        'fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]',
        'md:static md:h-dvh md:w-56 md:shrink-0 md:border-t-0 md:border-r md:pb-0',
      )}
    >
      <p className="hidden px-5 pt-8 pb-6 text-base font-semibold md:block">Casa</p>
      <ul className="flex md:flex-col md:gap-1 md:px-3">
        {DESTINATIONS.map(({ href, label, icon: Icon, built }) => {
          const active = built && (pathname === href || pathname.startsWith(`${href}/`));
          const className = cn(
            'flex h-tap flex-1 flex-col items-center justify-center gap-0.5 text-xs',
            'md:h-tap md:flex-row md:justify-start md:gap-3 md:rounded-control md:px-3 md:text-sm',
            active ? 'text-ink md:bg-paper md:font-medium' : 'text-ink-muted',
            built ? 'md:hover:bg-paper' : 'opacity-40',
          );

          return (
            <li key={href} className="flex flex-1">
              {built ? (
                <Link href={href} className={className} aria-current={active ? 'page' : undefined}>
                  <Icon />
                  {label}
                </Link>
              ) : (
                <span className={className} aria-disabled title={`${label} is not built yet`}>
                  <Icon />
                  {label}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Line icons, drawn here rather than pulled in: five paths is less than an icon package,
 * and currentColor keeps them on the palette by construction.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-5 shrink-0"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function HomeIcon() {
  return (
    <Icon>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </Icon>
  );
}

function MoneyIcon() {
  return (
    <Icon>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </Icon>
  );
}

function CalendarIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </Icon>
  );
}

function TravelIcon() {
  return (
    <Icon>
      <path d="M2.5 12.5 21 5l-4.5 8 4.5 8-18.5-7.5" />
    </Icon>
  );
}

function DocsIcon() {
  return (
    <Icon>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4M9 12h6M9 16h6" />
    </Icon>
  );
}
