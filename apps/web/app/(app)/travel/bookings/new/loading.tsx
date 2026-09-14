import {
  CardSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
} from '@/app/(app)/_components/ui/skeletons';

export default function Loading() {
  return (
    <LoadingRegion>
      <PageHeaderSkeleton />
      <CardSkeleton lines={8} />
    </LoadingRegion>
  );
}
