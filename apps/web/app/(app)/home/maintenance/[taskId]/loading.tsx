import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../../_components/ui/skeletons'

export default function MaintenanceLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={4} />
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={3} secondary />
        </div>
      </div>
    </LoadingRegion>
  )
}
