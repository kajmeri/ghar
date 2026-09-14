import { CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

const WEEKS = Array.from({ length: 5 }, (_, index) => index)
const DAYS = Array.from({ length: 7 }, (_, index) => index)

export default function Loading() {
  return (
    <LoadingRegion label='Loading calendar…'>
      <PageHeaderSkeleton action />
      <div className='flex flex-col gap-6'>
        <div className='flex flex-col gap-3'>
          <div className='flex h-tap items-center justify-between'>
            <span className='h-4 w-36 rounded-pill bg-line' />
            <span className='h-tap w-24 rounded-control bg-line/60' />
          </div>
          <div className='flex gap-2'>
            <span className='h-tap w-28 rounded-pill bg-line/60' />
            <span className='h-tap w-24 rounded-pill bg-line/60' />
          </div>
        </div>

        <div className='hidden overflow-hidden rounded-card border border-line bg-surface lg:block'>
          <div className='grid h-9 grid-cols-7' />
          {WEEKS.map(week => (
            <div key={week} className='grid grid-cols-7'>
              {DAYS.map(day => (
                <div key={day} className='h-32 border-t border-l border-line p-2 first:border-l-0'>
                  <span className='block size-5 rounded-pill bg-line/60' />
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className='flex flex-col gap-4 lg:hidden'>
          <div className='grid min-h-16 grid-cols-7 gap-2'>
            {DAYS.map(day => (
              <span key={day} className='rounded-control bg-line/40' />
            ))}
          </div>
          <CardSkeleton lines={2} />
          <CardSkeleton lines={3} />
        </div>

        <div>
          <SectionHeaderSkeleton description />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </LoadingRegion>
  )
}
