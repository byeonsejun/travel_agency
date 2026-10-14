import { test, expect, type Page } from "@playwright/test";
import { createSessionCookie, SEED_ADMIN } from "./helpers/auth";
import {
  E2E_LASTNAME,
  E2E_FIRSTNAME,
  purgeE2EBookings,
  closeTestDb,
  testDb,
} from "./helpers/db";

/**
 * GA4/GTM 분석 파이프라인 스모크 (ADR-0062).
 *
 * 1) 클라이언트 퍼널: 목록 → PDP → 체크아웃 이동 시 dataLayer 에 GA4 ecommerce 이벤트가
 *    KRW·정수 금액으로 쌓이는지. admin 셸은 GTM 미로드.
 * 2) 서버 purchase 아웃박스: Mock 결제 완료(PAID) 시 AnalyticsJob(PURCHASE) 가 같은 Tx 로
 *    적재되고, _ga 쿠키가 Booking.gaClientId 로 스냅샷되는지. (MP 발송은 cron 워커 — 범위 밖)
 *
 * 격리: playwright webServer 가 NEXT_PUBLIC_GTM_ID=GTM-E2ETEST 로 기동 + 여기서 Google 도메인
 * 요청을 전부 차단 → 실 GA4 로 E2E 트래픽 0.
 * self-cleaning: E2E 마커 예약 purge(AnalyticsJob 은 FK cascade 로 함께 삭제).
 */

test.afterAll(async () => {
  await purgeE2EBookings();
  await closeTestDb();
});

type DLEntry = { event?: string; ecommerce?: { currency?: string; value?: number } | null };

async function blockGoogle(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route(/googletagmanager\.com|google-analytics\.com|analytics\.google\.com/, (route) => {
    hits.push(route.request().url());
    return route.fulfill({ status: 204, body: "" });
  });
  return hits;
}

async function dataLayerEvents(page: Page): Promise<DLEntry[]> {
  return page.evaluate(() =>
    ((window as unknown as { dataLayer?: DLEntry[] }).dataLayer ?? []).filter(
      (e) => typeof e.event === "string" && !e.event.startsWith("gtm."),
    ),
  );
}

async function expectEvent(page: Page, name: string): Promise<DLEntry> {
  await expect
    .poll(async () => (await dataLayerEvents(page)).some((e) => e.event === name), { timeout: 15_000 })
    .toBe(true);
  const ev = (await dataLayerEvents(page)).find((e) => e.event === name)!;
  return ev;
}

/** 미래 SCHEDULED 출발편이 있는 PUBLISHED 상품 — 시드 날짜 노후화와 무관하게 결정적 선택. */
async function bookableDeparture(): Promise<{ id: string; productId: string }> {
  const dep = await testDb().departure.findFirst({
    where: {
      status: "SCHEDULED",
      departureDate: { gt: new Date() },
      product: { status: "PUBLISHED" },
    },
    orderBy: { departureDate: "asc" },
    select: { id: true, productId: true },
  });
  if (!dep) throw new Error("예약 가능한 미래 출발편 없음 — 로컬 DB 시드/출발일 확인");
  return dep;
}

test("클라이언트 퍼널: view_item_list → view_item → begin_checkout 이 KRW·정수 금액으로 dataLayer 적재", async ({
  page,
  context,
  baseURL,
}) => {
  await context.addCookies([await createSessionCookie(baseURL!)]);
  await blockGoogle(page);
  const dep = await bookableDeparture();

  await page.goto("/products");
  const list = await expectEvent(page, "view_item_list");
  expect(list.ecommerce).toBeTruthy();

  await page.goto(`/products/${dep.productId}`);
  const viewItem = await expectEvent(page, "view_item");
  expect(viewItem.ecommerce?.currency).toBe("KRW");
  expect(Number.isInteger(viewItem.ecommerce?.value)).toBe(true);

  await page.goto(`/products/${dep.productId}/checkout?departureId=${dep.id}`);
  const begin = await expectEvent(page, "begin_checkout");
  expect(begin.ecommerce?.currency).toBe("KRW");
  expect(Number.isInteger(begin.ecommerce?.value)).toBe(true);

  // purchase 는 클라이언트에서 절대 push 하지 않는다(서버 MP 단일 경로 — 이중 집계 방지)
  expect((await dataLayerEvents(page)).some((e) => e.event === "purchase")).toBe(false);
});

test("admin 셸에서는 GTM 을 로드하지 않는다", async ({ page, context, baseURL }) => {
  await context.addCookies([await createSessionCookie(baseURL!, SEED_ADMIN)]);
  const hits = await blockGoogle(page);
  await page.goto("/admin/dashboard");
  await expect(page).toHaveURL(/\/admin\/dashboard/);
  await page.waitForLoadState("networkidle");
  expect(hits).toHaveLength(0);
  expect(await page.evaluate(() => "dataLayer" in window)).toBe(false);
});

test("서버 purchase 아웃박스: Mock 결제 완료 시 AnalyticsJob(PURCHASE) 적재 + gaClientId 스냅샷", async ({
  page,
  context,
  baseURL,
}) => {
  const { hostname } = new URL(baseURL!);
  await context.addCookies([
    await createSessionCookie(baseURL!),
    // GTM 차단 상태이므로 브라우저 _ga 를 직접 심는다(GA4 태그가 발급하는 형식과 동일).
    { name: "_ga", value: "GA1.1.555666777.1790000000", domain: hostname, path: "/" },
  ]);
  await blockGoogle(page);
  const dep = await bookableDeparture();

  await page.goto(`/products/${dep.productId}/checkout?departureId=${dep.id}`);
  await page.locator("#ln-0").fill(E2E_LASTNAME);
  await page.locator("#fn-0").fill(E2E_FIRSTNAME);
  await page.locator("#gen-0").selectOption("MALE");
  await page.locator("#bd-0").fill("1990-01-01");
  const terms = page.locator('input[type="checkbox"]');
  const termCount = await terms.count();
  for (let i = 0; i < termCount; i++) await terms.nth(i).check();

  await page.getByRole("button", { name: /결제 진행/ }).click();
  await expectEvent(page, "add_payment_info");
  await page.getByRole("button", { name: "토스페이먼츠 결제창 열기" }).click();

  await expect(page).toHaveURL(/\/bookings\/[^/?#]+(\?|#|$)/, { timeout: 30_000 });
  await expect(page.getByText("결제 완료").first()).toBeVisible();
  const bookingId = new URL(page.url()).pathname.split("/")[2];

  const booking = await testDb().booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: { status: true, gaClientId: true },
  });
  expect(booking.status).toBe("PAID");
  expect(booking.gaClientId).toBe("555666777.1790000000");

  const job = await testDb().analyticsJob.findUnique({
    where: { dedupeKey: `ga-purchase:${bookingId}` },
    select: { type: true, status: true, bookingId: true },
  });
  expect(job).toEqual({ type: "PURCHASE", status: "PENDING", bookingId });
});
