"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { normalizeRoute } from "../model/normalizeRoute";
import { METRICS } from "../model/schema";

/**
 * Web Vitals 수집 island. RSC 레이아웃에 마운트.
 * useReportWebVitals 콜백이 메트릭별로 발화 → 정규화 → sendBeacon(/api/rum).
 * sendBeacon은 page unload 중에도 전송 보장(INP/LCP 종종 이탈 직전 확정).
 * UI 없음(null 렌더) — 부수효과 전용.
 */
export function WebVitalsReporter() {
  const pathname = usePathname();

  useReportWebVitals((metric) => {
    // Core Web Vitals 5종만 전송(커스텀 마크 무시).
    if (!(METRICS as readonly string[]).includes(metric.name)) return;

    const body = JSON.stringify({
      metric: metric.name,
      value: metric.value,
      route: normalizeRoute(pathname),
      navType: metric.navigationType,
    });

    // sendBeacon 우선(unload-safe), 미지원 시 keepalive fetch 폴백.
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/rum", body);
    } else {
      void fetch("/api/rum", {
        method: "POST",
        body,
        keepalive: true,
        headers: { "content-type": "application/json" },
      }).catch(() => {});
    }
  });

  return null;
}
