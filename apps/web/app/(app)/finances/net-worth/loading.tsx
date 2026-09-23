import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../_components/ui/skeletons'

export default function NetWorthLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={3} />
        <div className='flex flex-col gap-3'>
          <div className='flex justify-between gap-3'>
            <span className='h-tap w-48 rounded-control bg-line/60' />
            <span className='h-tap w-32 rounded-control bg-line/60' />
          </div>
          <div className='h-64 rounded-card border border-line bg-surface md:h-84' />
        </div>
        <div>
          <SectionHeaderSkeleton description />
          <DataListSkeleton rows={4} columns={1} />
        </div>
        <div>
          <SectionHeaderSkeleton description />
          <DataListSkeleton rows={2} columns={1} />
        </div>
      </div>
    </LoadingRegion>
  )
}
