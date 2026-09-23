import { DataListSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '../_components/ui/skeletons'

export default function RenewalsLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={3} columns={1} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={4} columns={1} />
        </div>
      </div>
    </LoadingRegion>
  )
}
