import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  env: {
    NODE_ENV: "production" as string,
    GA4_MEASUREMENT_ID: "G-TEST123" as string | undefined,
    GA4_API_SECRET: "secret_xyz" as string | undefined,
  },
  logInfo: vi.fn(),
}));

vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn() },
}));

import {
  MP_MAX_BACKDATE_MS,
  buildMpBody,
  buildPurchaseEvent,
  buildRefundEvent,
  isBeyondBackdateLimit,
  sendToGa4,
  toPurchaseItems,
} from "../mp";

const product = { productId: "p1", title: "오사카 3박4일", destination: "오사카, 일본" };

describe("toPurchaseItems — 예약 시점 단가 스냅샷(Traveler.unitPrice) 기반", () => {
  it("paxType·단가별로 묶어 quantity 집계, item_variant=소문자 paxType", () => {
    const items = toPurchaseItems(product, 2_500_000, [
      { paxType: "ADULT", unitPrice: 1_000_000 },
      { paxType: "ADULT", unitPrice: 1_000_000 },
      { paxType: "CHILD", unitPrice: 500_000 },
    ]);
    expect(items).toEqual([
      { item_id: "p1", item_name: "오사카 3박4일", item_category: "일본", price: 1_000_000, quantity: 2, item_variant: "adult" },
      { item_id: "p1", item_name: "오사카 3박4일", item_category: "일본", price: 500_000, quantity: 1, item_variant: "child" },
    ]);
  });

  it("paxType 이 없는 레거시 예약은 totalPrice 단일 item 으로 폴백", () => {
    expect(toPurchaseItems(product, 900_000, [{ paxType: null, unitPrice: 0 }])).toEqual([
      { item_id: "p1", item_name: "오사카 3박4일", item_category: "일본", price: 900_000, quantity: 1 },
    ]);
  });
});

describe("MP 이벤트 빌더", () => {
  it("purchase — transaction_id=bookingId, value=totalPrice(KRW)", () => {
    const ev = buildPurchaseEvent({ bookingId: "clbk1", value: 2_500_000, items: [] });
    expect(ev).toEqual({
      name: "purchase",
      params: { transaction_id: "clbk1", value: 2_500_000, currency: "KRW", items: [], engagement_time_msec: 1 },
    });
  });

  it("refund — 부분환불은 value 만(items 생략), 금액 정수 강제", () => {
    expect(buildRefundEvent({ bookingId: "clbk1", value: 300_000 })).toEqual({
      name: "refund",
      params: { transaction_id: "clbk1", value: 300_000, currency: "KRW", engagement_time_msec: 1 },
    });
    expect(() => buildRefundEvent({ bookingId: "clbk1", value: 1.5 })).toThrow(RangeError);
  });

  it("body — client_id 폴백(srv.<bookingId>) + timestamp_micros=occurredAt", () => {
    const at = new Date("2026-10-14T00:00:00Z");
    const body = buildMpBody({ clientId: null, bookingId: "clbk1", occurredAt: at, event: buildRefundEvent({ bookingId: "clbk1", value: 1 }) });
    expect(body.client_id).toBe("srv.clbk1");
    expect(body.timestamp_micros).toBe(at.getTime() * 1000);
    expect(body.events).toHaveLength(1);
  });

  it("body — gaClientId 가 있으면 그대로 사용", () => {
    const body = buildMpBody({ clientId: "123.456", bookingId: "b", occurredAt: new Date(), event: buildRefundEvent({ bookingId: "b", value: 1 }) });
    expect(body.client_id).toBe("123.456");
  });
});

describe("isBeyondBackdateLimit — MP 72h 백데이트 한도", () => {
  const now = new Date("2026-10-14T12:00:00Z");
  it("72h 이내면 false, 초과면 true", () => {
    expect(isBeyondBackdateLimit(new Date(now.getTime() - MP_MAX_BACKDATE_MS + 60_000), now)).toBe(false);
    expect(isBeyondBackdateLimit(new Date(now.getTime() - MP_MAX_BACKDATE_MS - 60_000), now)).toBe(true);
  });
});

describe("sendToGa4", () => {
  const body = buildMpBody({ clientId: "1.2", bookingId: "b", occurredAt: new Date(), event: buildRefundEvent({ bookingId: "b", value: 1 }) });
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.env.NODE_ENV = "production";
    mocks.env.GA4_MEASUREMENT_ID = "G-TEST123";
    mocks.env.GA4_API_SECRET = "secret_xyz";
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("production + 키 설정 → MP collect 엔드포인트로 POST", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 });
    await expect(sendToGa4(body)).resolves.toEqual({ mode: "sent" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://www.google-analytics.com/mp/collect?measurement_id=G-TEST123&api_secret=secret_xyz");
    expect(init).toMatchObject({ method: "POST" });
    expect(JSON.parse(init.body)).toEqual(body);
  });

  it("non-production → fetch 0, 로그만 (외부 IO 분기는 NODE_ENV 기준)", async () => {
    mocks.env.NODE_ENV = "development";
    await expect(sendToGa4(body)).resolves.toEqual({ mode: "dev-log" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.logInfo).toHaveBeenCalled();
  });

  it("키 미설정 → fetch 0 (분석 no-op)", async () => {
    mocks.env.GA4_MEASUREMENT_ID = undefined;
    mocks.env.GA4_API_SECRET = undefined;
    await expect(sendToGa4(body)).resolves.toEqual({ mode: "disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("non-2xx 응답은 throw (워커가 재시도)", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await expect(sendToGa4(body)).rejects.toThrow("503");
  });

  it("로그·에러 메시지에 api_secret 이 새지 않는다", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(sendToGa4(body)).rejects.not.toThrow(/secret_xyz/);
  });
});
