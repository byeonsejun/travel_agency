"use client";
import Link from "next/link";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/shared/ui/sheet";
import { Button } from "@/shared/ui/button";

const LINKS = [
  { href: "/products", label: "해외여행" },
  { href: "/products?destination=domestic", label: "국내여행" },
];

export function MobileNav() {
  // 링크 클릭 시 sheet 를 닫기 위해 open 상태를 제어 (Radix 기본은 외부 클릭/ESC 만).
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="메뉴 열기">
          <Menu className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent side="left">
        <SheetTitle className="text-lg font-bold text-primary">Nextour</SheetTitle>
        <nav className="mt-6 flex flex-col gap-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className="rounded-md px-2 py-3 text-base font-semibold hover:bg-accent"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}
