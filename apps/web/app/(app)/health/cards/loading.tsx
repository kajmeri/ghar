import { BackLinkSkeleton, CardSkeleton, LoadingRegion } from '../../_components/ui/skeletons'

/**
 * Mirrors the printable cards: the way back, the title with its date, and a card per person. Without
 * this the health page's own skeleton would stand in, and the page would jump when the cards came.
 */
export default function HealthCardsLoading() {
  return (
    <LoadingRegion>
      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-3'>
          <BackLinkSkeleton />
          <div>
            <span className='flex h-8 items-center'>
              <span className='h-5 w-48 rounded-pill bg-line' />
            </span>
            <span className='mt-1 flex h-5 items-center'>
              <span className='h-2.5 w-28 rounded-pill bg-line/60' />
            </span>
          </div>
        </div>
        <CardSkeleton lines={4} />
        <CardSkeleton lines={4} />
      </div>
    </LoadingRegion>
  )
}
