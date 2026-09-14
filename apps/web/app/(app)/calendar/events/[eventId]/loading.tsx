import { CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label='Loading event…'>
      <PageHeaderSkeleton action />
      <div className='flex flex-col gap-10'>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={4} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={2} />
        </div>
      </div>
    </LoadingRegion>
  )
}
