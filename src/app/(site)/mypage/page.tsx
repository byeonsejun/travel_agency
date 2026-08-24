import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server";
import { getCurrentUser, getPassportProfile } from "@/entities/user";
import { listMyBookings } from "@/entities/booking";
import { getReviewedBookingIds } from "@/entities/review";
import { listMyWishlist } from "@/entities/wishlist";
import { BookingHistoryList, BookingPaginator } from "@/widgets/booking-list";
import { PassportProfileForm } from "@/features/passport-profile";
import { WishlistGrid } from "@/widgets/wishlist-list";


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

  const [user, passport, { items: bookings, total }, wishlistItems] = await Promise.all([
    getCurrentUser(),
    getPassportProfile(session.user.id),
    listMyBookings(session.user.id, { page, pageSize: PAGE_SIZE }),
    listMyWishlist(session.user.id),
  ]);

  if (!user) {
    redirect("/login?callbackUrl=/mypage");
  }

  // 예약 카드의 "후기 작성/보기" 분기를 N+1 없이 결정하기 위한 사전 계산.
  // COMPLETED booking 만 후보 — 그 외 상태는 CTA 자체가 노출되지 않으므로 쿼리 제외.
  const completedBookingIds = bookings
    .filter((b) => b.status === "COMPLETED")
    .map((b) => b.id);
  const bookingIdsWithReview = await getReviewedBookingIds(completedBookingIds);

  const displayName = user.name ?? user.email ?? "고객";

  const wishlistCount = wishlistItems.length;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight text-foreground">마이페이지</h1>
        {wishlistCount > 0 && (
          <span
            aria-label={`찜한 상품 ${wishlistCount}개`}
            className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-rose-500 px-2 text-xs font-semibold leading-none text-white"
          >
            ♥ {wishlistCount}
          </span>
        )}
      </div>

      {/* 프로필 섹션 */}
      <section
        aria-labelledby="profile-heading"
        className="mt-6 rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <h2 id="profile-heading" className="sr-only">
          프로필
        </h2>
        <div className="flex items-center gap-4">
          <div
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-xl font-semibold text-primary"
          >
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold text-foreground">
              {displayName}
            </p>
            {user.email && (
              <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            )}
          </div>
        </div>
      </section>

      {/* 여권 정보 섹션 */}
      <section
        aria-labelledby="passport-heading"
        className="mt-8 rounded-xl border border-border bg-card p-6 shadow-card"
      >
        <div className="mb-5 flex items-baseline justify-between">
          <h2
            id="passport-heading"
            className="text-lg font-bold text-foreground"
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

      {/* 찜한 상품 섹션 (PRD §4.2 위시리스트) */}
      <section aria-labelledby="wishlist-heading" className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="wishlist-heading"
            className="text-lg font-bold text-foreground"
          >
            찜한 상품
          </h2>
          <span className="text-xs text-muted-foreground">
            총 {wishlistItems.length}건 · 최신순
          </span>
        </div>
        <WishlistGrid items={wishlistItems} />
      </section>

      {/* 예약 내역 섹션 */}
      <section aria-labelledby="bookings-heading" className="mt-10">
        <div className="mb-4 flex items-baseline justify-between">
          <h2
            id="bookings-heading"
            className="text-lg font-bold text-foreground"
          >
            예약 내역
          </h2>
          <span className="text-xs text-muted-foreground">
            총 {total}건 · 최신순
          </span>
        </div>
        <BookingHistoryList
          bookings={bookings}
          bookingIdsWithReview={bookingIdsWithReview}
        />
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
