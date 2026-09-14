import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../../_components/ui/skeletons'

export default function AssetLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={4} />
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={2} secondary />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={2} secondary />
        </div>
      </div>
    </LoadingRegion>
  )
}
