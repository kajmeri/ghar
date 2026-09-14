'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { MoreSheet } from './more-sheet';
import { isActive, MORE_ITEMS, TAB_ITEMS } from './nav';

const TAB_CLASS =
  'flex min-h-14 w-full flex-col items-center justify-center gap-1 text-xs focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset';

export function TabBar() {
  const pathname = usePathname();
  const moreActive = MORE_ITEMS.some((item) => isActive(pathname, item.href));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden"
    >
      <ul className="grid grid-cols-5">
        {TAB_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(TAB_CLASS, active ? 'font-medium text-ink' : 'text-ink-muted')}
              >
                <Icon aria-hidden className="size-6" strokeWidth={active ? 2.25 : 1.75} />
                {item.label}
              </Link>
            </li>
          );
        })}
        <li>
          <MoreSheet
            pathname={pathname}
            triggerClassName={cn(TAB_CLASS, moreActive ? 'font-medium text-ink' : 'text-ink-muted')}
            triggerStrokeWidth={moreActive ? 2.25 : 1.75}
          />
        </li>
      </ul>
    </nav>
  );
}
