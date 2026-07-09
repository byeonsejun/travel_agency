"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationSignal } from "./useNavigationSignal";

type Phase = "idle" | "loading" | "done";

/**
 * 전역 라우트 네비게이션 진행 바 (YouTube/nprogress 스타일 trickle).
 *
 * 이동 시작/완료 신호는 공용 `useNavigationSignal` 훅에서 받는다(오버레이와 신호원 공유).
 * 시작 시 바를 0%→90% 로 한 방향으로 차오르게 하고(ease-out → 처음 빠르고 점점 느려짐),
 * pathname/search 가 실제로 바뀌면 100% 로 채운 뒤 fade-out 한다.
 *
 * App Router 의 client-side 이동은 RSC 스트리밍이라 실제 수신 % 를 알 수 없다.
 * 그래서 정직한 determinate 가 불가능 → trickle(점근적 근사)로 한 번만 진행한다(반복 없음).
 *
 * 'use client' leaf, env import 없음. rAF/타이머는 모두 cleanup(메모리 누수 방어).
 */
export function GlobalRouteProgress() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [width, setWidth] = useState(0);

  const rafRef = useRef<number | null>(null);
  const doneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 이동 시작 → 0% 에서 90% 로 한 방향 trickle
  const handleStart = useCallback(() => {
    if (doneTimerRef.current) clearTimeout(doneTimerRef.current);
    setPhase("loading");
    setWidth(0);
    // 다음 두 프레임에 90% 로 — 0→90 의 CSS transition 이 실제로 발동되도록.
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = requestAnimationFrame(() => setWidth(90));
    });
  }, []);

  // 이동 완료 → 100% 채우고 fade-out
  const handleEnd = useCallback(() => {
    setPhase("done");
    setWidth(100);
    doneTimerRef.current = setTimeout(() => {
      setPhase("idle");
      setWidth(0);
    }, 400);
  }, []);

  useNavigationSignal({ onStart: handleStart, onEnd: handleEnd });

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
