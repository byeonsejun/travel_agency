import Link from "next/link";
import { UserNavIsland } from "@/features/auth";

export default function SiteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // cookies 의존 auth() 호출은 UserNavIsland 의 client-fetch 로 격리 (ADR-0018).
  // layout 본체는 cookies 의존 0 → 모든 자식 페이지 정적 prerender 자격 회복
  // (특히 /products/[id] 가 ISR `●` 표기로 승격).
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
            <UserNavIsland />
          </nav>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
