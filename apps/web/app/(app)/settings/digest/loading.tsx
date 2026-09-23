import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-10'>
        <div className='flex flex-col gap-6'>
          <CardSkeleton lines={1} />
          <CardSkeleton lines={7} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </LoadingRegion>
  )
}
