import { SharedTripFrame } from '@/app/_components/shared-trip'

export default function SharedTripsLoading() {
  return (
    <SharedTripFrame>
      <div aria-busy='true' className='flex flex-col gap-6'>
        <p role='status' className='sr-only'>
          Loading trips shared with you…
        </p>
        <div aria-hidden className='flex flex-col gap-6'>
          <div className='flex flex-col gap-2'>
            <span className='h-7 w-48 rounded-pill bg-line' />
            <span className='h-4 w-64 max-w-full rounded-pill bg-line/60' />
          </div>
          <span className='block h-24 rounded-card border border-line bg-surface' />
          <span className='block h-24 rounded-card border border-line bg-surface' />
        </div>
      </div>
    </SharedTripFrame>
  )
}
