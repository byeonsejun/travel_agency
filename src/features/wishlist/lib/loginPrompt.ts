// 비로그인 유저가 찜 클릭 시 노출되는 confirm 문구.
// PDP `WishlistHeartIsland` 와 목록 `WishlistHeartButton` 이 같은 문구를 쓰도록 중앙화.
export const LOGIN_PROMPT_MESSAGE =
  "로그인 후 이용하실 수 있습니다.\n로그인하시겠습니까?";

// /login?callbackUrl=<여기서 만든 URL> 형태로 합성될 resume 엔드포인트 URL.
// 로그인 성공 후 /api/wishlist/resume 가 idempotent upsert(add-only) 처리 후
// returnTo 로 redirect 한다.
export function buildResumeCallbackUrl(
  productId: string,
  returnTo: string,
): string {
  return (
    "/api/wishlist/resume" +
    `?productId=${encodeURIComponent(productId)}` +
    `&returnTo=${encodeURIComponent(returnTo)}`
  );
}
