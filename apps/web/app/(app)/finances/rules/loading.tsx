import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton } from '../../_components/ui/skeletons'

export default function RulesLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-2'>
        {[0, 1, 2].map(row => (
          <CardSkeleton key={row} lines={2} />
        ))}
      </div>
    </LoadingRegion>
  )
}
