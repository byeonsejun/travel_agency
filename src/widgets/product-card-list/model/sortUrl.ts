/**
 * 정렬 변경 시 이동할 /products URL 을 만든다.
 * - sort 를 새 값으로 교체
 * - page 는 버린다(정렬이 바뀌면 1페이지부터)
 * - 그 외 쿼리(destination 등)는 보존
 */
export function nextSortUrl(params: URLSearchParams, value: string): string {
  const next = new URLSearchParams(params.toString());
  next.set("sort", value);
  next.delete("page");
  return `/products?${next.toString()}`;
}
