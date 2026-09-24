import {
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description />
      <div className='flex flex-col gap-8'>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={2} secondary />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={3} secondary />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </LoadingRegion>
  )
}
