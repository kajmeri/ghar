import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export default function TripNotFound() {
  return (
    <EmptyState
      title="That trip is not here"
      action={
        <Button asChild variant="outline">
          <Link href="/travel">Back to travel</Link>
        </Button>
      }
    >
      It may have been deleted, or it belongs to another household.
    </EmptyState>
  );
}
