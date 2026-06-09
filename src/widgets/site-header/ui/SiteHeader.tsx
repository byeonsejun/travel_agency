import Link from "next/link";
import { UserNavIsland } from "@/features/auth";
import { MobileNav } from "./MobileNav";

const LINKS = [
  { href: "/products", label: "해외여행" },
  { href: "/products?destination=domestic", label: "국내여행" },
];

// 서버 컴포넌트 — cookies 의존 0 유지(auth 는 UserNavIsland 내부 client-fetch, ADR-0018).
// layout 의 정적 prerender 자격을 보존하기 위해 헤더 본체는 cookies 를 만지지 않는다.
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-6">
        <MobileNav />
        <Link href="/" className="text-2xl font-extrabold tracking-tight text-primary">
          Nextour
        </Link>
        <nav className="hidden gap-7 text-base font-semibold md:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="border-b-2 border-transparent py-1 hover:border-primary hover:text-primary"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <UserNavIsland />
        </div>
      </div>
    </header>
  );
}
