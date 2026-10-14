"use client";

import { useEffect, useRef } from "react";
import { trackEvent, type Ga4EventPayload } from "@/shared/lib/analytics";

type Props = {
  /** 서버(RSC)가 `@/shared/lib/analytics` 빌더로 만든 직렬화 가능한 payload. */
  payload: Ga4EventPayload;
  /**
   * 발화 식별 키(예: productId). 같은 키로는 1회만 발화 — StrictMode 이중 effect·
   * RSC 리렌더(payload 객체 identity 변경)에도 중복 전송하지 않는다.
   * 키가 바뀌면(다른 상품으로 client 이동, 컴포넌트 재사용) 새로 발화.
   */
  dedupeKey: string;
};

/**
 * GA4 노출 이벤트 island (ADR-0062). RSC 페이지가 'use client' 전환 없이 이벤트를 쏘게 하는
 * 최소 리프 — UI 없음(null 렌더), 부수효과 전용(WebVitalsReporter 와 동형).
 * 동적 훅(usePathname 등) 미사용 → Suspense 경계 불요(정적 셸 무손상).
 */
export function TrackEvent({ payload, dedupeKey }: Props) {
  const firedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (firedKeyRef.current === dedupeKey) return;
    firedKeyRef.current = dedupeKey;
    trackEvent(payload);
  }, [dedupeKey, payload]);

  return null;
}
