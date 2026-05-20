import { Suspense } from "react";
import Link from "next/link";
import { UserNav, UserNavSkeleton } from "@/features/auth/ui/UserNav";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 쿠키 의존 auth() 호출은 UserNav 안으로 격리. layout 본체는 정적이므로
  // PPR opt-in 라우트에서 헤더 chrome·logo는 prerender, user-section만
  // Suspense fallback(UserNavSkeleton)으로 시작해 실제 세션 결과로 swap된다.
  return (
    <>
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link
            href="/"
            className="text-lg font-bold text-indigo-600 hover:text-indigo-700"
          >
            Nextour
          </Link>

          <nav className="flex items-center gap-2">
            <Suspense fallback={<UserNavSkeleton />}>
              <UserNav />
            </Suspense>
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
