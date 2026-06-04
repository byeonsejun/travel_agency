"use client";

import { useLinkStatus } from "next/link";

/**
 * 부모 <Link> 의 네비게이션 펜딩(useLinkStatus)을 읽어 상단 진행 바를 표시.
 * <Link> 의 자식으로 렌더되어야 동작한다(useLinkStatus 제약).
 * 타이머/리스너 없음 → cleanup 불필요. env import 없음(client-safe).
 *
 * 트랙(옅은 배경) 위에 좁은 바가 좌→우로 무한 슬라이드하는 indeterminate 진행 바.
 * (얇은 펄스 선은 느린 네트워크에서도 육안 식별이 어려워 슬라이드 바로 교체 — globals.css keyframe)
 */
export function RouteProgress() {
  const { pending } = useLinkStatus();

  if (!pending) return null;

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
