"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "loading" | "done";

/**
 * 전역 라우트 네비게이션 진행 바 (YouTube/nprogress 스타일 trickle).
 *
 * 내부 링크(<a href="/...">) 클릭을 capture 단계에서 잡아 "이동 시작"을 감지하고,
 * 바를 0%→90% 로 한 방향으로 차오르게 한다(ease-out 곡선 → 처음 빠르고 점점 느려짐).
 * pathname/search 가 실제로 바뀌면 "이동 완료"로 보고 100% 로 채운 뒤 fade-out 한다.
 *
 * App Router 의 client-side 이동은 RSC 스트리밍이라 실제 수신 % 를 알 수 없다.
 * 그래서 정직한 determinate 가 불가능 → trickle(점근적 근사)로 한 번만 진행한다(반복 없음).
 *
 * 'use client' leaf, env import 없음. 클릭 리스너/rAF/타이머는 모두 cleanup(메모리 누수 방어).
 */
export function GlobalRouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();

  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState(0);

  const phaseRef = useRef<Phase>(phase);
  phaseRef.current = phase;
  const rafRef = useRef<number | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 내부 링크 클릭 = 이동 시작 → 0% 에서 90% 로 한 방향 trickle
  useEffect(() => {
    const current = pathname + (searchString ? `?${searchString}` : "");

    function onClick(e: MouseEvent) {
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
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (href === current) return;

      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
      setPhase("loading");
      setWidth(0);
      // 다음 두 프레임에 90% 로 — 0→90 의 CSS transition 이 실제로 발동되도록.
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => setWidth(90));
      });
    }

    // capture 단계: Next <Link> 의 preventDefault 보다 먼저 실행되어야 클릭을 잡는다.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchString]);

  // pathname/search 변화 = 이동 완료 → 100% 채우고 fade-out
  useEffect(() => {
    if (phaseRef.current !== "loading") return;
    setPhase("done");
    setWidth(100);
    doneTimerRef.current = setTimeout(() => {
      setPhase("idle");
      setWidth(0);
    }, 400);
  }, [pathname, searchString]);

  // 언마운트 시 rAF·타이머 정리
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    };
  }, []);

  if (phase === "idle") return null;

  const isDone = phase === "done";

  return (
    <div
      role="progressbar"
      aria-label="페이지 이동 중"
      className="fixed inset-x-0 top-0 z-[100] h-1"
    >
      <div
        className="h-full bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.6)]"
        style={{
          width: `${width}%`,
          opacity: isDone ? 0 : 1,
          // loading: 0→90 을 ease-out 으로 천천히(처음 빠르고 점점 느려짐 = trickle)
          // done: 90→100 을 빠르게 채우고 살짝 늦게 fade-out
          transition: isDone
            ? "width 180ms ease-out, opacity 300ms ease-out 150ms"
            : "width 8s cubic-bezier(0.08, 0.82, 0.17, 1)",
        }}
      />
    </div>
  );
}
