import { Skeleton } from '@/components/ui/skeleton';

export default function HouseholdLoading() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-9 w-52" />
      <Skeleton className="h-40 rounded-card" />
    </div>
  );
}
