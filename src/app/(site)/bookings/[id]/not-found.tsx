import Link from "next/link";

export default function BookingNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <h1 className="text-xl font-bold text-foreground">예약을 찾을 수 없습니다</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        존재하지 않거나 접근 권한이 없는 예약입니다.
      </p>
      <Link
        href="/"
        className="mt-8 inline-block rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        홈으로 돌아가기
      </Link>
    </div>
  );
}
