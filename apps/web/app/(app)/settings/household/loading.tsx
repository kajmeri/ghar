import { CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-10'>
        <div>
          <SectionHeaderSkeleton />
          <div className='flex flex-col gap-3'>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={2} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={4} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <div className='flex flex-col gap-3'>
            <CardSkeleton lines={3} />
            <CardSkeleton lines={3} />
          </div>
        </div>
      </div>
    </LoadingRegion>
  )
}
