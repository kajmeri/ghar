import { DataListSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '../_components/ui/skeletons'

export default function HealthLoading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-6'>
        <div className='flex flex-wrap gap-2'>
          {[0, 1, 2].map(index => (
            <div key={index} className='h-tap w-24 rounded-pill border border-line bg-surface' />
          ))}
        </div>
        <div>
          <SectionHeaderSkeleton />
          <DataListSkeleton rows={4} columns={1} />
        </div>
      </div>
    </LoadingRegion>
  )
}
