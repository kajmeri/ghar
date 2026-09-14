import type { ReactNode } from 'react';
import { AppNav } from './_components/app-nav';

/**
 * The shell. Mobile is the real layout: content, then a fixed bottom tab bar that respects
 * the safe area. Desktop is the same thing with room to breathe, so the bar becomes a
 * sidebar and the content gets a max width rather than filling the screen.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="md:flex md:min-h-dvh">
      <AppNav />
      <div className="flex-1 md:min-w-0">
        <main className="mx-auto w-full max-w-content px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+--spacing(24))] md:px-8 md:pt-10 md:pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}
