import { Skeleton } from '@/components/ui/skeleton'

export default function DecisionsLoading() {
  return (
    <div className='flex flex-col gap-6'>
      <Skeleton className='h-9 w-56' />
      <div className='flex flex-col gap-2'>
        <Skeleton className='h-16 rounded-card' />
        <Skeleton className='h-16 rounded-card' />
        <Skeleton className='h-16 rounded-card' />
      </div>
    </div>
  )
}
