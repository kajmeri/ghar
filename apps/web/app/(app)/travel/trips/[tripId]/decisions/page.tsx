import { redirect } from 'next/navigation'

/** Trips live at /travel/[tripId]; this keeps /travel/trips/[tripId]/decisions working too. */
export default async function DecisionsRedirect({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  redirect(`/travel/${tripId}/decisions`)
}
