import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton } from '../../_components/ui/skeletons'

export default function RenewalLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <CardSkeleton lines={5} />
    </LoadingRegion>
  )
}
