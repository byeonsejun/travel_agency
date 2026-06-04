import { Skeleton } from "@/shared/ui/Skeleton";
import { BookingRowSkeleton } from "@/widgets/booking-list";

export default function MyPageLoading() {
  return (
    <div className="mx-auto max-w-5xl space-y-10 px-6 py-12">
      {/* 프로필 카드 */}
      <section className="space-y-4 rounded-lg border border-gray-200 p-6">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </section>
      {/* 예약 내역 */}
      <section className="space-y-4">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <BookingRowSkeleton key={i} />
        ))}
      </section>
      {/* 위시리스트 */}
      <section className="space-y-4">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 w-full rounded-lg" />
          ))}
        </div>
      </section>
    </div>
  );
}
