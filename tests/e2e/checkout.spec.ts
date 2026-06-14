import { test, expect } from "@playwright/test";
import { createSessionCookie } from "./helpers/auth";

/**
 * 스모크 1 — 체크아웃 happy path (쿠키 주입 인증).
 *
 * 홈 → 상품 카드 → PDP → 예약가능 출발편 → 체크아웃(여행자 입력·약관)
 * → 결제(devFallback) → confirm(Mock 토스 200) → 예약 상세가 PAID로 보이는지 단언.
 *
 * 전제: 개발 DB가 시드되어 있어야 한다(시드 customer FK + 예약가능 출발편).
 */
test("체크아웃 happy path: 예약 생성 후 결제 완료(PAID)까지 완주", async ({
  page,
  context,
  baseURL,
}) => {
  // 1) 시드 customer 세션 쿠키 주입 — 옵션 A(prod 인증 무변경)
  await context.addCookies([await createSessionCookie(baseURL!)]);

  // 2) 홈 → 첫 상품 카드 클릭 → PDP 진입
  await page.goto("/");
  const firstCard = page.locator('a[href^="/products/"]').first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page).toHaveURL(/\/products\/[^/?#]+(\?|#|$)/);

  // 3) PDP → 첫 "예약하기"(예약가능 출발편) → 체크아웃
  const reserveLink = page.getByRole("link", { name: "예약하기" }).first();
  await expect(reserveLink).toBeVisible();
  await reserveLink.click();
  await expect(page).toHaveURL(/\/checkout\?departureId=/);

  // 4) 여행자 정보(예약자 1명) 입력 — 기본 인원: 성인 1
  await page.locator("#ln-0").fill("HONG");
  await page.locator("#fn-0").fill("GILDONG");
  await page.locator("#gen-0").selectOption("MALE");
  await page.locator("#bd-0").fill("1990-01-01");

  // 5) 필수 약관 전체 동의 (해외여행 표준약관 + 특별 취소·환불 규정)
  const terms = page.locator('input[type="checkbox"]');
  const termCount = await terms.count();
  expect(termCount).toBeGreaterThan(0);
  for (let i = 0; i < termCount; i++) {
    await terms.nth(i).check();
  }

  // 6) 예약 진행 → 결제 위젯으로 전환
  await page.getByRole("button", { name: /결제 진행/ }).click();
  const payButton = page.getByRole("button", {
    name: "토스페이먼츠 결제창 열기",
  });
  await expect(payButton).toBeVisible();

  // 7) 결제 클릭 → devFallback이 success로 직행 → ConfirmPayment가 Mock confirm 호출
  await payButton.click();

  // 8) confirm 성공(Mock 200) → /bookings/{id} 로 replace + "결제 완료" 배지 단언
  await expect(page).toHaveURL(/\/bookings\/[^/?#]+(\?|#|$)/, {
    timeout: 30_000,
  });
  await expect(page.getByText("결제 완료").first()).toBeVisible();
});
