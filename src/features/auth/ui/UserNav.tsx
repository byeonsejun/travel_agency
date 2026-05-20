import Link from "next/link";
import { auth } from "@/features/auth/server/auth";
import { LogoutButton } from "./LogoutButton";

/**
 * 헤더 우상단의 사용자 영역(이름·마이페이지·로그아웃 vs 로그인 버튼).
 *
 * 쿠키를 읽는 auth()를 호출하므로 이 컴포넌트는 본질적으로 dynamic.
 * 부모(layout)가 <Suspense>로 감싸 PPR이 정적 본문과 분리해 streaming
 * shell로 처리하게 한다.
 */
export async function UserNav() {
  const session = await auth();
  const user = session?.user;

  if (user) {
    return (
      <>
        <span className="text-sm text-gray-600">
          {user.name ?? user.email}
        </span>
        <Link
          href="/mypage"
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          마이페이지
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
