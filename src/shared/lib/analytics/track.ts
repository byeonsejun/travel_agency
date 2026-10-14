/**
 * dataLayer push 래퍼 (ADR-0062). client-safe — env/db import 금지.
 * GTM 이 아직 로드 전이어도 배열에 큐잉되어 로드 후 처리된다.
 */
import type { Ga4EventPayload } from "./events";

// @next/third-parties 가 전역 window.dataLayer 를 Object[] 로 선언 — 그와 호환되는 object[] 사용.
type DataLayerWindow = Window & { dataLayer?: object[] };

export function trackEvent(payload: Ga4EventPayload): void {
  if (typeof window === "undefined") return; // SSR no-op

  const w = window as DataLayerWindow;
  // GTM 이 만든 배열을 교체하면 GTM 의 push 훅이 끊긴다 → 없을 때만 생성.
  w.dataLayer = w.dataLayer ?? [];
  // GA4 권장: 이전 ecommerce 객체가 다음 이벤트에 병합 잔존하지 않도록 먼저 비운다.
  if ("ecommerce" in payload) w.dataLayer.push({ ecommerce: null });
  w.dataLayer.push(payload);
}
