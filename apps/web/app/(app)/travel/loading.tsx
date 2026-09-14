import { Skeleton } from '@/components/ui/skeleton'

export default function TravelLoading() {
  return (
    <div className='flex flex-col gap-10'>
      <Skeleton className='h-9 w-40' />
      <Skeleton className='h-28 w-full rounded-card' />
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-6 w-28' />
        <div className='grid gap-3 md:grid-cols-2'>
          <Skeleton className='h-40 rounded-card' />
          <Skeleton className='h-40 rounded-card' />
        </div>
      </div>
    </div>
  )
}
