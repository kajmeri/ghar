import { Skeleton } from '@/components/ui/skeleton'

export default function DaySheetLoading() {
  return (
    <div className='flex flex-col gap-6'>
      <Skeleton className='h-9 w-64' />
      {[0, 1].map(section => (
        <div key={section} className='flex flex-col gap-2'>
          <Skeleton className='h-6 w-48' />
          <Skeleton className='h-12' />
          <Skeleton className='h-12' />
          <Skeleton className='h-12' />
        </div>
      ))}
    </div>
  )
}
