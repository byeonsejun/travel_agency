import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getCurrentUser } from "@/entities/user";
import { listMyBookings } from "@/entities/booking";
import { BookingHistoryList } from "@/widgets/booking-list";

export const dynamic = "force-dynamic";

export default async function MyPage() {
  // 1차 가드(미들웨어가 먼저 막지만 RSC 자체 가드도 belt-and-suspenders).
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/mypage");
  }

  // 프로필·예약내역 병렬 패칭 — 독립 쿼리, 직렬 비용 회피 (CLAUDE.md §6).
  const [user, bookings] = await Promise.all([
    getCurrentUser(),
    listMyBookings(session.user.id),
  ]);

  // 세션 직후 사용자 레코드가 사라지는 매우 드문 케이스의 안전망.
  if (!user) {
    redirect("/login?callbackUrl=/mypage");
  }

  const displayName = user.name ?? user.email ?? "고객";

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900">마이페이지</h1>

      {/* 프로필 섹션 */}
      <section
        aria-labelledby="profile-heading"
        className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <h2 id="profile-heading" className="sr-only">
          프로필
        </h2>
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-xl font-semibold text-indigo-700"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-semibold text-gray-900">
              {displayName}
            </p>
            {user.email && (
              <p className="truncate text-sm text-gray-500">{user.email}</p>
            )}
          </div>
        </div>
      </section>

      {/* 예약 내역 섹션 */}
      <section aria-labelledby="bookings-heading" className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="bookings-heading"
            className="text-lg font-semibold text-gray-900"
          >
            예약 내역
          </h2>
          <span className="text-xs text-gray-400">
            총 {bookings.length}건 · 최신순
          </span>
        </div>
        <BookingHistoryList bookings={bookings} />
      </section>
    </div>
  );
}
