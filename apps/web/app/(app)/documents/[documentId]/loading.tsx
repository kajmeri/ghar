import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton action />
      <CardSkeleton lines={6} />
    </LoadingRegion>
  )
}
