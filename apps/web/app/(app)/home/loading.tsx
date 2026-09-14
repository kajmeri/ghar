import {
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SearchFieldSkeleton,
  SectionHeaderSkeleton,
} from '../_components/ui/skeletons'

export default function HouseLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <div>
          <SectionHeaderSkeleton />
          <div className='flex flex-col gap-3'>
            <SearchFieldSkeleton />
            <DataListSkeleton rows={4} leading secondary />
          </div>
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={3} secondary />
        </div>
      </div>
    </LoadingRegion>
  )
}
