import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton, ProgressBarSkeleton } from '../../_components/ui/skeletons'

export default function BudgetLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description />
      <div className='flex flex-col gap-8'>
        <div className='flex items-center justify-between gap-3'>
          <span className='size-tap rounded-control bg-line/60' />
          <span className='h-6 w-40 rounded-control bg-line/60' />
          <span className='size-tap rounded-control bg-line/60' />
        </div>
        <CardSkeleton lines={3} />
        <div className='flex flex-col gap-3'>
          {[0, 1, 2].map(row => (
            <div key={row} className='rounded-card border border-line bg-surface p-4 md:p-5'>
              <ProgressBarSkeleton />
            </div>
          ))}
        </div>
        <div className='h-60 rounded-card border border-line bg-surface md:h-72' />
      </div>
    </LoadingRegion>
  )
}
