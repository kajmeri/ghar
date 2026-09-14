import { listHouseholdMembers } from '@casa/db/queries';
import Link from 'next/link';
import { requireSession } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { toHouseholdMember } from '@/lib/travel/serialize';
import { MemberList } from './_components/member-list';

export const metadata = { title: 'Household · Casa' };

/**
 * Who is in the household, and what it calls them.
 *
 * Supabase owns the accounts; this is the only place a name is set, and every list that
 * shows a person reads it. Adding and removing people is not here yet: that belongs with
 * the invite flow, which arrives with sign-in.
 */
export default async function HouseholdPage() {
  const session = await requireSession();
  const members = (await listHouseholdMembers(getDb(), session.context)).map(toHouseholdMember);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <Link href="/travel" className="text-sm text-ink-muted underline underline-offset-4">
          Travel
        </Link>
        <h1 className="text-2xl font-semibold">{session.household.name}</h1>
        <p className="text-sm text-ink-muted">
          Names here are what everyone sees on a packing list or a trip.
        </p>
      </header>

      <MemberList
        members={members}
        currentUserId={session.context.userId}
        canRenameAnyone={session.context.role === 'owner'}
      />
    </div>
  );
}
