import {
  BackLinkSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
  StatGroupSkeleton,
} from '../../_components/ui/skeletons'

export default function TrendsLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton />
      <div className='flex flex-col gap-8'>
        <StatGroupSkeleton count={3} />
        <div className='flex flex-col gap-3'>
          <div className='flex justify-between gap-3'>
            <span className='h-7 w-40 rounded-control bg-line/60' />
            <span className='h-tap w-28 rounded-control bg-line/60' />
          </div>
          <div className='h-[31rem] rounded-card border border-line bg-surface md:h-[36rem]' />
        </div>
        <div>
          <SectionHeaderSkeleton description />
          <DataListSkeleton rows={5} trailing />
        </div>
      </div>
    </LoadingRegion>
  )
}
