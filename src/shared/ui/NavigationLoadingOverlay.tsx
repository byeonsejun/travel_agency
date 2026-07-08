"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigationSignal } from "./useNavigationSignal";

/** START 후 이만큼 지나도 여전히 pending 이면 오버레이 노출 (순간 이동은 스킵). */
const SHOW_DELAY_MS = 400;
/** 노출 후 이 시간이 지나면 강제 해제 — 네비 무산 시 UI 잠김 방지 안전장치. */
const AUTO_DISMISS_MS = 8000;

/**
 * 라우트 네비게이션 로딩 오버레이.
 *
 * 이동 시작/완료 신호는 진행 바와 **같은** `useNavigationSignal` 훅에서 받는다.
 * 시작 후 400ms 안에 끝나는 순간 이동은 오버레이를 띄우지 않고, 그보다 느린 이동에서만
 * 얕은 딤 + 회전 나침반 + 안내 문구를 보여준다. 완료(URL 커밋) 시 즉시 사라진다.
 *
 * z-index 는 헤더(20)·모달(50) 위, 진행 바(100) 아래(z-[90]) — 진행 바가 오버레이 위에 계속 보인다.
 * 'use client' leaf, env import 없음. 모든 타이머는 cleanup(메모리 누수 방어).
 */
export function NavigationLoadingOverlay() {
  const [visible, setVisible] = useState(false);

  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) {
      clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (autoTimerRef.current) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const handleStart = useCallback(() => {
    clearTimers();
    // threshold: 400ms 후에도 pending 이면 노출.
    showTimerRef.current = setTimeout(() => {
      setVisible(true);
      // 노출된 순간부터 자동 해제 카운트다운 시작(네비가 끝내 완료되지 않아도 잠기지 않게).
      autoTimerRef.current = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    }, SHOW_DELAY_MS);
  }, [clearTimers]);

  const handleEnd = useCallback(() => {
    clearTimers();
    setVisible(false);
  }, [clearTimers]);

  useNavigationSignal({ onStart: handleStart, onEnd: handleEnd });

  // 언마운트 시 타이머 정리
  useEffect(() => () => clearTimers(), [clearTimers]);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="페이지를 불러오는 중입니다"
      className="fixed inset-0 z-[90] flex items-center justify-center animate-in fade-in duration-200"
      style={{ backgroundColor: "rgba(15, 22, 38, 0.10)" }}
    >
      {/* 얕은 딤 위에서도 문구가 또렷하도록 옅은 글래스 백킹 */}
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/75 px-8 py-7 shadow-float ring-1 ring-black/5 backdrop-blur-sm">
        {/* 회전 나침반 — 파비콘과 동일한 컴퍼스 로즈. reduced-motion 시 회전 정지. */}
        <div
          className="h-12 w-12 animate-spin motion-reduce:animate-none"
          style={{ animationDuration: "1.6s" }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 64 64" className="h-full w-full">
            {/* 고정 다이얼 링 (회전 불변) */}
            <circle
              cx="32"
              cy="32"
              r="27"
              fill="none"
              stroke="hsl(var(--primary) / 0.16)"
              strokeWidth="3"
            />
            {/* 컴퍼스 로즈 = 회전하는 needle */}
            <path
              d="M32 12 L36 28 L52 32 L36 36 L32 52 L28 36 L12 32 L28 28 Z"
              fill="hsl(var(--primary))"
            />
            {/* 중심점 (회전 불변) */}
            <circle cx="32" cy="32" r="3" fill="hsl(var(--primary))" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            잠시만 기다려주세요
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            페이지를 불러오는 중입니다
          </p>
        </div>
      </div>
    </div>
  );
}
