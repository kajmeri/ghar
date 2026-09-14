import { DataListSkeleton, LoadingRegion, PageHeaderSkeleton } from '@/app/(app)/_components/ui/skeletons'

export default function Loading() {
  return (
    <LoadingRegion label='Loading bookings…'>
      <PageHeaderSkeleton action />
      <DataListSkeleton rows={4} secondary columns={3} trailing />
    </LoadingRegion>
  )
}
