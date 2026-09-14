import {
  CardSkeleton,
  LoadingRegion,
  PageHeaderSkeleton,
  SectionHeaderSkeleton,
  StatGroupSkeleton,
} from '@/app/(app)/_components/ui/skeletons';

export default function Loading() {
  return (
    <LoadingRegion label="Loading booking…">
      <PageHeaderSkeleton action />
      <div className="flex flex-col gap-10">
        <StatGroupSkeleton count={4} />
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={6} />
        </div>
        <div>
          <SectionHeaderSkeleton />
          <CardSkeleton lines={3} />
        </div>
      </div>
    </LoadingRegion>
  );
}
