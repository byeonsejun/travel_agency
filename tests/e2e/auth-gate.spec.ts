import { test, expect } from "@playwright/test";

/**
 * 스모크 2 — 인증 게이트 (미인증).
 *
 * 쿠키 주입 없이 보호 라우트(/mypage)에 접근하면 미들웨어가 /login으로
 * 리다이렉트하는지 단언한다. 컨텍스트는 테스트마다 새로 생성되므로(쿠키 0)
 * 결정적으로 미인증 상태가 보장된다.
 */
test("인증 게이트: 미인증 /mypage 접근 시 /login 으로 리다이렉트", async ({
  page,
}) => {
  await page.goto("/mypage");

  // 미들웨어: /mypage(보호) → /login?callbackUrl=/mypage
  await expect(page).toHaveURL(/\/login(\?|$)/);
});
