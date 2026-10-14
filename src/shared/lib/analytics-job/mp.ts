/**
 * mp.ts — GA4 Measurement Protocol 클라이언트 (ADR-0062).
 *
 * 순수 빌더(purchase/refund 이벤트, body) + 단일 IO 함수 `sendToGa4`.
 * - 외부 IO 분기는 NODE_ENV 만 기준(프로젝트 규칙): production 이 아니면 fetch 0, 로그만.
 * - api_secret 은 URL 쿼리로만 전달하고 로그·에러 메시지에 절대 싣지 않는다.
 * - 금액은 정수(원) — 동결 스냅샷(Booking.totalPrice / RefundJob.amount)만 사용.
 */

import { env } from "@/shared/lib/env";
import { logger } from "@/shared/lib/observability";
import { GA4_CURRENCY, toGa4Item, type Ga4Item } from "@/shared/lib/analytics";

const MP_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/** MP 는 timestamp_micros 를 최대 72시간까지만 백데이트 허용 — 초과분은 GA4 가 버린다. */
export const MP_MAX_BACKDATE_MS = 72 * 3_600_000;

export interface MpEvent {
  name: "purchase" | "refund";
  params: {
    transaction_id: string;
    value: number;
    currency: typeof GA4_CURRENCY;
    items?: Ga4Item[];
    /** MP 이벤트가 GA4 세션/실시간 보고서에 잡히려면 양수가 필요. */
    engagement_time_msec: number;
  };
}

export interface MpBody {
  client_id: string;
  timestamp_micros: number;
  events: MpEvent[];
}

function assertWon(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`GA4 MP value 는 0 이상의 정수(원)여야 합니다: ${value}`);
  }
}

/**
 * 예약 시점 단가 스냅샷(Traveler.paxType/unitPrice)으로 item 을 구성한다 — 출발일 가격이
 * 이후 바뀌어도 구매 당시 금액이 유지된다. paxType 이 없는 레거시 예약은 totalPrice 단일 item.
 */
export function toPurchaseItems(
  product: { productId: string; title: string; destination: string },
  totalPrice: number,
  travelers: ReadonlyArray<{ paxType: string | null; unitPrice: number }>,
): Ga4Item[] {
  if (travelers.length === 0 || travelers.some((t) => t.paxType === null)) {
    return [toGa4Item({ ...product, unitPrice: totalPrice })];
  }
  const groups = new Map<string, { variant: string; unitPrice: number; quantity: number }>();
  for (const t of travelers) {
    const variant = (t.paxType as string).toLowerCase();
    const key = `${variant}:${t.unitPrice}`;
    const g = groups.get(key);
    if (g) g.quantity += 1;
    else groups.set(key, { variant, unitPrice: t.unitPrice, quantity: 1 });
  }
  return [...groups.values()].map((g) =>
    toGa4Item({ ...product, unitPrice: g.unitPrice, quantity: g.quantity, variant: g.variant }),
  );
}

export function buildPurchaseEvent(input: {
  bookingId: string;
  value: number;
  items: Ga4Item[];
}): MpEvent {
  assertWon(input.value);
  return {
    name: "purchase",
    params: {
      transaction_id: input.bookingId,
      value: input.value,
      currency: GA4_CURRENCY,
      items: input.items,
      engagement_time_msec: 1,
    },
  };
}

/** 부분환불 포함 — GA4 는 value 만 있는 refund 를 허용(items 생략). */
export function buildRefundEvent(input: { bookingId: string; value: number }): MpEvent {
  assertWon(input.value);
  return {
    name: "refund",
    params: {
      transaction_id: input.bookingId,
      value: input.value,
      currency: GA4_CURRENCY,
      engagement_time_msec: 1,
    },
  };
}

/**
 * client_id 가 없으면(쿠키 차단·레거시 예약) `srv.<bookingId>` 폴백 — 매출 집계는 보존,
 * 브라우저 세션 귀속(유입 경로)만 잃는다.
 */
export function buildMpBody(input: {
  clientId: string | null;
  bookingId: string;
  occurredAt: Date;
  event: MpEvent;
}): MpBody {
  return {
    client_id: input.clientId ?? `srv.${input.bookingId}`,
    timestamp_micros: input.occurredAt.getTime() * 1000,
    events: [input.event],
  };
}

export function isBeyondBackdateLimit(occurredAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - occurredAt.getTime() > MP_MAX_BACKDATE_MS;
}

export type SendResult = { mode: "sent" | "dev-log" | "disabled" };

export async function sendToGa4(body: MpBody): Promise<SendResult> {
  if (!env.GA4_MEASUREMENT_ID || !env.GA4_API_SECRET) {
    return { mode: "disabled" };
  }
  if (env.NODE_ENV !== "production") {
    logger.info("analytics.mp.dev", {
      clientId: body.client_id,
      events: body.events.map((e) => ({ name: e.name, value: e.params.value })),
    });
    return { mode: "dev-log" };
  }

  const url =
    `${MP_ENDPOINT}?measurement_id=${encodeURIComponent(env.GA4_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(env.GA4_API_SECRET)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // URL(api_secret 포함)은 메시지에 싣지 않는다.
    throw new Error(`GA4 MP HTTP ${res.status}`);
  }
  return { mode: "sent" };
}
