import { BackLinkSkeleton, DataListSkeleton, LoadingRegion, PageHeaderSkeleton, SearchFieldSkeleton } from '../../_components/ui/skeletons'

export default function TransactionsLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description />
      <div className='flex flex-col gap-4'>
        <div className='flex flex-col gap-3'>
          <SearchFieldSkeleton />
          <div className='flex flex-wrap gap-3'>
            <span className='h-tap min-w-40 flex-1 rounded-control bg-line/60' />
            <span className='h-tap min-w-40 flex-1 rounded-control bg-line/60' />
            <span className='h-tap min-w-40 flex-1 rounded-control bg-line/60' />
          </div>
        </div>
        <DataListSkeleton rows={8} columns={1} />
      </div>
    </LoadingRegion>
  )
}
