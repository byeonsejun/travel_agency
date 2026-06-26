import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/features/auth/server/auth";
import { LogoutButton } from "@/features/auth/ui/LogoutButton";

// admin 상단 네비 메뉴 SSOT — 라벨/링크 단일 정의. 항목 추가·수정은 이 배열만.
const ADMIN_NAV: { label: string; href: string }[] = [
  { label: "대시보드", href: "/admin/dashboard" },
  { label: "예약", href: "/admin/bookings" },
  { label: "환불", href: "/admin/refund-jobs" },
  { label: "상품", href: "/admin/products" },
  { label: "위약금", href: "/admin/penalty-policies" },
  { label: "임베딩 Jobs", href: "/admin/embedding-jobs" },
  { label: "취소", href: "/admin/departure-cancellations" },
  { label: "리뷰", href: "/admin/reviews" },
];

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
            <nav className="flex items-center gap-1 overflow-x-auto text-sm">
              {ADMIN_NAV.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="whitespace-nowrap rounded-md px-2 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {item.label}
                </Link>
              ))}
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
