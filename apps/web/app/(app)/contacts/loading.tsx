import { DataListSkeleton, LoadingRegion, PageHeaderSkeleton, SearchFieldSkeleton } from '../_components/ui/skeletons'

export default function ContactsLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-3'>
        <SearchFieldSkeleton />
        <DataListSkeleton rows={5} leading secondary />
      </div>
    </LoadingRegion>
  )
}
