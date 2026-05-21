import Link from "next/link";
import { auth } from "@/features/auth/server/auth";
import { countMyWishlist } from "@/entities/wishlist";
import { LogoutButton } from "./LogoutButton";

/**
 * 헤더 우상단의 사용자 영역(이름·마이페이지·로그아웃 vs 로그인 버튼).
 *
 * 쿠키를 읽는 auth()를 호출하므로 이 컴포넌트는 본질적으로 dynamic.
 * 부모(layout)가 <Suspense>로 감싸 PPR이 정적 본문과 분리해 streaming
 * shell로 처리하게 한다.
 *
 * 찜 카운트 뱃지: toggleWishlistAction 이 revalidatePath(returnTo) 를 호출하면
 * 같은 경로의 layout 도 함께 SSR 재실행되어 자동 동기화. dynamic 컴포넌트라
 * 별도 캐시 태깅·revalidateTag 불필요.
 */
export async function UserNav() {
  const session = await auth();
  const user = session?.user;

  if (user?.id) {
    const wishlistCount = await countMyWishlist(user.id);

    return (
      <>
        <span className="text-sm text-gray-600">
          {user.name ?? user.email}
        </span>
        <Link
          href="/mypage"
          className="relative rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          마이페이지
          {wishlistCount > 0 && (
            <span
              aria-label={`찜한 상품 ${wishlistCount}개`}
              className="ml-1.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold leading-none text-white"
            >
              {wishlistCount > 99 ? "99+" : wishlistCount}
            </span>
          )}
        </Link>
        <LogoutButton />
      </>
    );
  }

  return (
    <Link
      href="/login"
      className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
    >
      로그인
    </Link>
  );
}

/**
 * PPR Suspense fallback — auth() 결과를 기다리는 동안 보여줄 정적 스켈레톤.
 * 정적 prerender에 포함되므로 첫 페인트에서 즉시 노출되고, 이후 실제
 * UserNav가 hydration과 함께 stream-in 된다.
 */
export function UserNavSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="h-7 w-20 animate-pulse rounded-md bg-gray-100"
    />
  );
}
