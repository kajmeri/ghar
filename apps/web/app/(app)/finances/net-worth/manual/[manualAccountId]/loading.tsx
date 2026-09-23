import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../../../_components/ui/skeletons'

export default function ManualAccountLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={4} />
        <div>
          <SectionHeaderSkeleton description />
          <DataListSkeleton rows={4} trailing={false} />
        </div>
      </div>
    </LoadingRegion>
  )
}
