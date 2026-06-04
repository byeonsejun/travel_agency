"use client";

import { useLinkStatus } from "next/link";

/**
 * 부모 <Link> 의 네비게이션 펜딩(useLinkStatus)을 읽어 상단 진행 바를 표시.
 * <Link> 의 자식으로 렌더되어야 동작한다(useLinkStatus 제약).
 * 타이머/리스너 없음 → cleanup 불필요. env import 없음(client-safe).
 */
export function RouteProgress() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

  return (
    <span
      role="progressbar"
      aria-label="페이지 이동 중"
      className="fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-blue-600"
    />
  );
}
