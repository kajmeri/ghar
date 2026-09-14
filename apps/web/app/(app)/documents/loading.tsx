import { EmptyStateSkeleton, LoadingRegion, PageHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <EmptyStateSkeleton />
    </LoadingRegion>
  )
}
