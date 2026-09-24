import { Skeleton } from '@/components/ui/skeleton'

export default function TripGuestsLoading() {
  return (
    <div className='flex flex-col gap-6'>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-4 w-32' />
        <Skeleton className='h-9 w-40' />
      </div>
      <div className='grid gap-6 md:grid-cols-2'>
        <Skeleton className='h-48 rounded-card' />
        <Skeleton className='h-48 rounded-card' />
      </div>
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-16 rounded-card' />
        <Skeleton className='h-16 rounded-card' />
      </div>
    </div>
  )
}
