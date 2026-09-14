import { Skeleton } from '@/components/ui/skeleton'

export default function TravelModeLoading() {
  return (
    <div className='flex flex-col gap-6'>
      <Skeleton className='h-10 w-72' />
      <Skeleton className='h-36 rounded-card' />
      <Skeleton className='h-36 rounded-card' />
    </div>
  )
}
