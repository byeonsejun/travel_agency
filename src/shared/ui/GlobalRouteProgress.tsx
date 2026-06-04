"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * 전역 라우트 네비게이션 진행 바.
 *
 * 내부 링크(<a href="/...">) 클릭을 캡처해 "이동 시작"을 감지하고,
 * pathname/searchParams 가 실제로 바뀌면 "이동 완료"로 보고 숨긴다.
 * 상품 카드·헤더·위시리스트 등 사이트의 모든 <Link> 이동을 단일 컴포넌트로 커버한다
 * (useLinkStatus per-link 방식은 적용한 링크에서만 동작 + prefetch 완료 시 미표시 한계).
 *
 * 'use client' leaf, env import 없음. 클릭 리스너/타임아웃은 cleanup 처리(메모리 누수 방어).
 */
export function GlobalRouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();
  const [navigating, setNavigating] = useState(false);

  // pathname/search 가 바뀌면 = 이동 완료 → 진행 바 숨김
  useEffect(() => {
    setNavigating(false);
  }, [pathname, searchString]);

  // 내부 링크 클릭 = 이동 시작 → 진행 바 표시
  useEffect(() => {
    const current = pathname + (searchString ? `?${searchString}` : "");

    function onClick(e: MouseEvent) {
      // 새 탭/수정자 클릭·우클릭은 SPA 이동이 아님
      // (defaultPrevented 는 체크하지 않는다 — Link 가 bubble 단계에서 preventDefault 하므로
      //  capture 단계의 이 리스너 시점엔 아직 false. 그래서 capture=true 로 등록.)
      if (
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      ) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      // 내부 절대 경로(/...)만. 외부·해시·새 탭 제외.
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (href === current) return; // 같은 URL 재클릭은 이동 아님

      setNavigating(true);
    }

    // capture 단계: Next <Link> 의 preventDefault 보다 먼저 실행되어야 클릭을 잡는다.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchString]);

  // 안전장치: 이동이 끝내 완료되지 않아도(같은 URL·차단 등) 진행 바가 영구히 남지 않도록.
  useEffect(() => {
    if (!navigating) return;
    const timer = setTimeout(() => setNavigating(false), 8000);
    return () => clearTimeout(timer);
  }, [navigating]);

  if (!navigating) return null;

  return (
    <span
      role="progressbar"
      aria-label="페이지 이동 중"
      className="fixed inset-x-0 top-0 z-[100] block h-1 overflow-hidden bg-blue-100"
    >
      <span
        aria-hidden="true"
        className="block h-full w-1/3 rounded-r-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)]"
        style={{ animation: "route-progress-slide 1.1s ease-in-out infinite" }}
      />
    </span>
  );
}
