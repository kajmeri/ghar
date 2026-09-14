import {
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SearchFieldSkeleton,
} from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton action />
      <div className='flex flex-col gap-3'>
        <SearchFieldSkeleton />
        <DataListSkeleton rows={6} leading />
      </div>
    </LoadingRegion>
  )
}
