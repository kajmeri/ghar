import {
  BackLinkSkeleton,
  CardSkeleton,
  DataListSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
} from '../../_components/ui/skeletons'

export default function ContactLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={3} />
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={2} secondary />
        </div>
      </div>
    </LoadingRegion>
  )
}
