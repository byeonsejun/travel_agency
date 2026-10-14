/**
 * mp-validate.ts — GA4 Measurement Protocol payload 스키마 검증 (ADR-0062).
 *
 * 서버 워커가 보내는 purchase/refund body 를 **같은 빌더**(analytics-job/mp)로 만들어
 * GA4 공식 검증 엔드포인트 `/debug/mp/collect` 로 POST 한다. debug 엔드포인트는
 * 데이터를 수집·저장하지 않으므로 GA4 리포트를 오염시키지 않는다(검증 전용).
 *
 * 기대 결과: 각 이벤트 `validationMessages: []` (빈 배열 = 스키마 통과).
 * 가드: GA4_MEASUREMENT_ID / GA4_API_SECRET 미설정 시 즉시 중단. api_secret 은 출력하지 않는다.
 * 실행: npm run analytics:validate   (내부: tsx --env-file=.env)
 */
import { env } from "@/shared/lib/env";
import {
  buildMpBody,
  buildPurchaseEvent,
  buildRefundEvent,
  toPurchaseItems,
  type MpBody,
} from "@/shared/lib/analytics-job/mp";

const DEBUG_ENDPOINT = "https://www.google-analytics.com/debug/mp/collect";

interface ValidationResponse {
  validationMessages: Array<{ fieldPath?: string; description?: string; validationCode?: string }>;
}

async function validate(label: string, body: MpBody, measurementId: string, apiSecret: string): Promise<boolean> {
  const url =
    `${DEBUG_ENDPOINT}?measurement_id=${encodeURIComponent(measurementId)}` +
    `&api_secret=${encodeURIComponent(apiSecret)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as ValidationResponse;
  const ok = res.ok && json.validationMessages.length === 0;
  console.log(`[${label}] HTTP ${res.status} validationMessages=${JSON.stringify(json.validationMessages)} → ${ok ? "PASS" : "FAIL"}`);
  return ok;
}

async function main(): Promise<void> {
  const measurementId = env.GA4_MEASUREMENT_ID;
  const apiSecret = env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) {
    console.error("GA4_MEASUREMENT_ID / GA4_API_SECRET 미설정 — .env 확인 후 재실행");
    process.exit(1);
  }

  const bookingId = "mp_validate_sample";
  const items = toPurchaseItems(
    { productId: "p_sample", title: "오사카 3박4일 (검증 샘플)", destination: "오사카, 일본" },
    2_500_000,
    [
      { paxType: "ADULT", unitPrice: 1_000_000 },
      { paxType: "ADULT", unitPrice: 1_000_000 },
      { paxType: "CHILD", unitPrice: 500_000 },
    ],
  );
  const occurredAt = new Date(Date.now() - 60_000);

  const results = await Promise.all([
    validate(
      "purchase",
      buildMpBody({
        clientId: "123456789.1700000000",
        bookingId,
        occurredAt,
        event: buildPurchaseEvent({ bookingId, value: 2_500_000, items }),
      }),
      measurementId,
      apiSecret,
    ),
    validate(
      "refund (partial, srv.* client_id fallback)",
      buildMpBody({
        clientId: null,
        bookingId,
        occurredAt,
        event: buildRefundEvent({ bookingId, value: 300_000 }),
      }),
      measurementId,
      apiSecret,
    ),
  ]);

  if (results.some((ok) => !ok)) process.exit(1);
  console.log("ALL PASS — 서버 MP payload 가 GA4 스키마와 일치");
}

void main();
