import { CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-8'>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </LoadingRegion>
  )
}
