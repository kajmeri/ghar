import { BackLinkSkeleton, CardSkeleton, LoadingRegion, PageHeaderSkeleton, SectionHeaderSkeleton } from '../../_components/ui/skeletons'

export default function CategoriesLoading() {
  return (
    <LoadingRegion>
      <BackLinkSkeleton />
      <PageHeaderSkeleton description action />
      <div className='flex flex-col gap-8'>
        {[0, 1].map(group => (
          <div key={group}>
            <SectionHeaderSkeleton />
            <div className='flex flex-col gap-2'>
              {[0, 1, 2, 3].map(row => (
                <CardSkeleton key={row} lines={1} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}
