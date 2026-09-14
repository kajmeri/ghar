import { can } from '@ghar/core/auth';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getPageContext } from '@/lib/auth/context';
import * as travel from '@/lib/travel/service';
import { PageHeader } from '../../../_components/ui/page-header';
import { BackLink } from '../_components/back-link';
import { BookingForm } from '../_components/booking-form';

export const metadata: Metadata = { title: 'Add booking' };

export default async function NewBookingPage() {
  const { ctx } = await getPageContext();
  if (!can(ctx.role, 'travel.manage')) redirect('/travel/bookings');
  const { timezone, currency } = await travel.getTravelSettings(ctx);

  return (
    <>
      <BackLink href="/travel/bookings">Bookings</BackLink>
      <PageHeader
        title="Add booking"
        description="What you paid is what drops are measured against."
      />
      <BookingForm currency={currency} timeZone={timezone} />
    </>
  );
}
