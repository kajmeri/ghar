import {
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
  StatGroupSkeleton,
} from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-8'>
        <StatGroupSkeleton />
        <div>
          <SectionHeaderSkeleton description />
          <DataListSkeleton rows={5} trailing />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={5} trailing />
        </div>
      </div>
    </LoadingRegion>
  )
}
