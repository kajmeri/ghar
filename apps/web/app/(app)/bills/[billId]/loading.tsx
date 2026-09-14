import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../_components/ui/skeletons'

export default function BillLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={5} />
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={4} secondary={false} />
        </div>
      </div>
    </LoadingRegion>
  )
}
