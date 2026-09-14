import { NotFoundError } from '@ghar/core/errors';
import { notFound } from 'next/navigation';
import { getPageSession } from '@/lib/api/authed';
import { loadTravelMode } from '@/lib/travel/trips';
import { TravelModeView } from './_components/travel-mode-view';

export const metadata = { title: 'Travel mode' };

/**
 * Travel mode. What you need today, in large type, with the confirmation codes one tap
 * from the clipboard.
 *
 * The server renders the first copy so it is there before any script runs; the view below
 * keeps its own copy so the page still works on a plane.
 */
export default async function TravelModePage({ params }: { params: Promise<{ tripId: string }> }) {
  const session = await getPageSession();
  const { tripId } = await params;

  const mode = await loadTravelMode(session, tripId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });

  return <TravelModeView initial={mode} />;
}
