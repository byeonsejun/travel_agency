import { Skeleton } from "@/shared/ui/Skeleton";

export function BookingRowSkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-border p-4">
      <Skeleton className="h-16 w-16 shrink-0 rounded-md" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
      </div>
      <Skeleton className="h-8 w-20 rounded" />
    </div>
  );
}
