import { DataListSkeleton, LoadingRegion, PageHeaderSkeleton } from '../_components/ui/skeletons'

export default function BillsLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description action />
      <DataListSkeleton rows={5} columns={1} />
    </LoadingRegion>
  )
}
