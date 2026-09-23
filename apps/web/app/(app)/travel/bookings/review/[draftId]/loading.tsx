import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label='Loading booking…'>
      <BackLinkSkeleton />
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-6'>
        <CardSkeleton lines={3} />
        <CardSkeleton lines={8} />
      </div>
    </LoadingRegion>
  )
}
