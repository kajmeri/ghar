import { NotFoundError } from '@ghar/core/errors'
import { tripInviteTokenSchema } from '@ghar/contracts'
import * as guests from '@/lib/travel/guests'

// A guest's calendar feed. Calendar apps can't sign in, so the URL's token is the key: it opens
// one trip's dates and decided plan, for as long as its guest is on the trip. Outside /api/v1
// because it answers in iCalendar, not JSON.

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const parsed = tripInviteTokenSchema.safeParse((await params).token)
  if (!parsed.success) return notFound()
  try {
    const { name, ics } = await guests.tripCalendarFile(parsed.data)
    return new Response(ics, {
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'content-disposition': `inline; filename="${fileName(name)}.ics"`,
        // Private to whoever holds the URL, and never kept by a shared cache.
        'cache-control': 'private, max-age=900',
        'referrer-policy': 'no-referrer',
        'x-robots-tag': 'noindex',
      },
    })
  } catch (error) {
    if (error instanceof NotFoundError) return notFound()
    throw error
  }
}

function notFound(): Response {
  return new Response('This calendar link is off.', {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** ASCII only, so the header stays valid whatever the trip is called. */
function fileName(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .toLowerCase() || 'trip'
  )
}
