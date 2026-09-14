import { Skeleton } from '@/components/ui/skeleton'

export default function TripLoading() {
  return (
    <div className='flex flex-col gap-6'>
      <Skeleton className='h-9 w-64' />
      <Skeleton className='h-11 w-full max-w-sm' />
      <div className='flex flex-col gap-3'>
        <Skeleton className='h-6 w-32' />
        <Skeleton className='h-24 rounded-card' />
        <Skeleton className='h-24 rounded-card' />
      </div>
    </div>
  )
}
