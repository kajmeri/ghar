import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton, ProgressBarSkeleton } from '../../_components/ui/skeletons'

export default function GoalsLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        <CardSkeleton lines={3} />
        <div className='flex flex-col gap-3'>
          {[0, 1, 2].map(row => (
            <div key={row} className='rounded-card border border-line bg-surface p-4 md:p-5'>
              <ProgressBarSkeleton />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}
