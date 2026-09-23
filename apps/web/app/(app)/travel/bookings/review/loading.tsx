import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label='Loading bookings to check…'>
      <BackLinkSkeleton />
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-8'>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={3} secondary trailing />
        </div>
        <div>
          <SectionHeaderSkeleton description />
          <CardSkeleton />
        </div>
      </div>
    </LoadingRegion>
  )
}
