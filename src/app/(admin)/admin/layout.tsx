import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

// /admin/* 는 middleware에서 1차 ADMIN role 가드. 이 layout이 2차 belt-and-suspenders.
// 미들웨어 우회/오설정 회귀 방지.
//
// [ADR-0053] cacheComponents: auth()는 동적 읽기(쿠키) → 반드시 <Suspense> 안에서 호출해야
// prerender를 막지 않는다. 가드(auth+redirect)와 {children}을 단일 AdminAuthedShell 안에 두어
// (a) 동적 읽기를 Suspense로 격리하고 (b) children이 가드 통과 후에만 렌더되도록 순서를 보존하며
// (c) 16개 admin page의 동적 데이터가 이 단일 경계 안에 들어와 페이지별 Suspense가 불요해진다.
export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-muted">
      <Suspense fallback={<AdminShellFallback />}>
        <AdminAuthedShell>{children}</AdminAuthedShell>
      </Suspense>
    </div>
  );
}

async function AdminAuthedShell({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/bookings");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/"); // 미인증 admin 진입자는 홈으로
  }

  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <Link
              href="/admin/bookings"
              className="text-lg font-bold text-primary hover:text-primary/90"
            >
              Nextour Admin
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              <Link
                href="/admin/dashboard"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                대시보드
              </Link>
              <Link
                href="/admin/bookings"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                예약 관리
              </Link>
              <Link
                href="/admin/refund-jobs"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                환불 모니터링
              </Link>
              <Link
                href="/admin/products"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                상품 관리
              </Link>
              <Link
                href="/admin/penalty-policies"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                위약금 정책
              </Link>
              <Link
                href="/admin/embedding-jobs"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                임베딩 Jobs
              </Link>
              <Link
                href="/admin/departure-cancellations"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                취소 배치
              </Link>
              <Link
                href="/admin/reviews"
                className="rounded-md px-3 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                리뷰 관리
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">
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
    </>
  );
}

// prerender되는 정적 셸 — auth() 해소 전 스트리밍 fallback.
function AdminShellFallback() {
  return (
    <>
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-[57px] max-w-6xl items-center px-4">
          <div className="h-5 w-28 animate-pulse rounded bg-muted" />
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <div className="h-72 animate-pulse rounded-xl border border-border bg-card" />
      </main>
    </>
  );
}
