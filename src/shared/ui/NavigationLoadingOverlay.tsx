"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CompassLoader } from "./CompassLoader";
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
 * 나침반 로딩 비주얼(`CompassLoader`)을 보여준다. 완료(URL 커밋) 시 즉시 사라진다.
 *
 * 이 1단계 오버레이와 2단계 라우트 `loading.tsx` 는 **같은 `CompassLoader`** 를 공유한다 →
 * URL 커밋 순간 1단계 hide 와 2단계 loading.tsx show 가 동일 렌더 커밋에서 교대되어 나침반이 끊기지 않는다.
 * 진입 페이드(`animate-in fade-in`)는 1단계 최초 노출에만 적용(2단계는 인계라 즉시 표시 → 깜빡임 없음).
 *
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

  // 최초 노출에만 진입 페이드. 2단계 loading.tsx 는 이 페이드 없이 즉시 표시(인계 seamless).
  return <CompassLoader className="animate-in fade-in duration-200" />;
}
