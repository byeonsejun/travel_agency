import Link from "next/link";
import { Button } from "@/shared/ui/button";

export default function AdminBookingNotFound() {
  return (
    <div className="rounded-xl border border-border bg-card p-12 text-center">
      <h1 className="text-xl font-bold text-foreground">
        예약을 찾을 수 없습니다
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        존재하지 않는 예약 ID입니다.
      </p>
      <Button asChild className="mt-6">
        <Link href="/admin/bookings">예약 목록으로</Link>
      </Button>
    </div>
  );
}
