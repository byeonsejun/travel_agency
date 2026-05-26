// 위시리스트 토글이 일어났음을 같은 페이지의 다른 island 들(특히 layout 의
// `UserNavIsland` 의 헤더 카운트 뱃지) 에 알리는 client-only event bus.
//
// 왜 필요한가:
//   - `UserNavIsland` 는 layout 에 박혀 있어 RSC re-render 의 영향을 받지 않음.
//   - 토글 후 `router.refresh()` 만으로는 헤더의 count 가 갱신되지 않음.
//   - Context · 전역 상태 도입은 과한 결합 — 이 한 가지 알림에는 native
//     CustomEvent 가 가장 가볍고 SSR-safe.
//
// 사용:
//   토글 측: `dispatchWishlistChanged()` 를 Server Action `await` 직후 호출.
//   구독 측: `useEffect` 안에서 `subscribeWishlistChanged(refetch)` 등록,
//           cleanup 에서 반환 함수 호출.

export const WISHLIST_CHANGED_EVENT = "wishlist-changed";

export function dispatchWishlistChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WISHLIST_CHANGED_EVENT));
}

export function subscribeWishlistChanged(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(WISHLIST_CHANGED_EVENT, handler);
  return () => {
    window.removeEventListener(WISHLIST_CHANGED_EVENT, handler);
  };
}
