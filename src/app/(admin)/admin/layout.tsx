import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

// /admin/* 는 middleware에서 1차 ADMIN role 가드. 이 layout이 2차 belt-and-suspenders.
// 미들웨어 우회/오설정 회귀 방지.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/bookings");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/"); // 미인증 admin 진입자는 홈으로
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/admin/bookings"
              className="text-lg font-bold text-red-700 hover:text-red-800"
            >
              Nextour Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/admin/dashboard"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                대시보드
              </Link>
              <Link
                href="/admin/bookings"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                예약 관리
              </Link>
              <Link
                href="/admin/refund-jobs"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                환불 모니터링
              </Link>
              <Link
                href="/admin/products"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                상품 관리
              </Link>
              <Link
                href="/admin/embedding-jobs"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                임베딩 Jobs
              </Link>
              <Link
                href="/admin/departure-cancellations"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                취소 배치
              </Link>
              <Link
                href="/admin/reviews"
                className="rounded-md px-3 py-1.5 font-medium text-gray-700 hover:bg-gray-100"
              >
                리뷰 관리
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">
              {session.user.name ?? session.user.email}
              <span className="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                ADMIN
              </span>
            </span>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
