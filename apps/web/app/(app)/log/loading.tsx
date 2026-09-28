import { LoadingRegion, PageHeaderSkeleton } from '../_components/ui/skeletons'

/** Mirrors the quick log before anything is typed: the sentence field, its button and the hint below. */
export default function LogLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-2'>
        <div className='flex items-end gap-2'>
          <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
            <span className='flex h-5 items-center'>
              <span className='h-2.5 w-28 rounded-pill bg-line' />
            </span>
            <span className='block h-tap rounded-control border border-line bg-surface' />
          </div>
          <span className='h-tap w-20 shrink-0 rounded-control bg-line/60' />
        </div>
        <span className='flex h-5 items-center'>
          <span className='h-2.5 w-72 max-w-full rounded-pill bg-line/60' />
        </span>
      </div>
    </LoadingRegion>
  )
}
