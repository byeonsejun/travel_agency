"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

interface NavigationSignalCallbacks {
  /** 내부 링크 클릭으로 라우트 이동이 "시작"됐을 때 */
  onStart: () => void;
  /** pathname/search 가 실제로 바뀌어 이동이 "완료"됐을 때 (start 이후에만 발화) */
  onEnd: () => void;
}

/**
 * 라우트 네비게이션 신호 SSOT 훅.
 *
 * 내부 링크(`<a href="/...">`) 클릭을 **capture 단계**에서 잡아 "이동 시작"을,
 * `usePathname`/`useSearchParams` 변화로 "이동 완료"를 감지해 콜백으로 통지한다.
 * 진행 바(`GlobalRouteProgress`)와 로딩 오버레이(`NavigationLoadingOverlay`)가
 * **동일한 판정 로직**(클릭 가드·완료 감지)을 공유하도록 신호 출처를 이 한 곳으로 모은다.
 * → 두 소비자의 신호가 절대 드리프트하지 않는다.
 *
 * 클릭 가드(button/modifier/anchor/href/target/same-url)와 완료 감지는
 * 기존 `GlobalRouteProgress` 인라인 구현과 **동작 100% 동일**하다. 신호 출처만 훅으로 이동했다.
 *
 * 'use client' leaf, env import 없음. 클릭 리스너는 cleanup 으로 정리(메모리 누수 방어).
 */
export function useNavigationSignal({
  onStart,
  onEnd,
}: NavigationSignalCallbacks): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchString = searchParams.toString();

  // 콜백 최신값을 ref 로 참조 — 콜백 변화로 리스너를 재등록하지 않기 위함.
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);
  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  // in-flight 여부 — 완료(onEnd)는 시작(onStart) 이후에만 발화하도록 하는 가드.
  // (기존 GRP 의 `phaseRef.current === "loading"` 가드와 동일한 역할)
  const pendingRef = useRef(false);

  // 내부 링크 클릭 = 이동 시작
  useEffect(() => {
    const current = pathname + (searchString ? `?${searchString}` : "");

    function onClick(e: MouseEvent) {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) {
        return;
      }
      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || !href.startsWith("/")) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (href === current) return;

      pendingRef.current = true;
      onStartRef.current();
    }

    // capture 단계: Next <Link> 의 preventDefault 보다 먼저 실행되어야 클릭을 잡는다.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [pathname, searchString]);

  // pathname/search 변화 = 이동 완료 (시작 이후에만)
  useEffect(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    onEndRef.current();
  }, [pathname, searchString]);
}
