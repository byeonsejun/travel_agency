import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { getCurrentUser, getPassportProfile } from "@/entities/user";
import { listMyBookings } from "@/entities/booking";
import { BookingHistoryList, BookingPaginator } from "@/widgets/booking-list";
import { PassportProfileForm } from "@/features/passport-profile";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 5;

type PageProps = {
  searchParams: Promise<{ page?: string }>;
};

export default async function MyPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/mypage");
  }

  const { page: rawPage } = await searchParams;
  const page = Math.max(1, parseInt(rawPage ?? "1", 10) || 1);

  const [user, passport, { items: bookings, total }] = await Promise.all([
    getCurrentUser(),
    getPassportProfile(session.user.id),
    listMyBookings(session.user.id, { page, pageSize: PAGE_SIZE }),
  ]);

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

      {/* 여권 정보 섹션 */}
      <section
        aria-labelledby="passport-heading"
        className="mt-8 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
      >
        <div className="mb-5 flex items-baseline justify-between">
          <h2
            id="passport-heading"
            className="text-lg font-semibold text-gray-900"
          >
            여권 정보
          </h2>
          {passport && (
            <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
              등록됨
            </span>
          )}
          {!passport && (
            <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-700">
              미등록
            </span>
          )}
        </div>
        <PassportProfileForm initial={passport} />
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
            총 {total}건 · 최신순
          </span>
        </div>
        <BookingHistoryList bookings={bookings} />
        <BookingPaginator
          page={page}
          total={total}
          pageSize={PAGE_SIZE}
          basePath="/mypage"
        />
      </section>
    </div>
  );
}
