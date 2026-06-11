/**
 * 원시 pathname → route 템플릿 접기 (RUM cardinality 제어 SSOT).
 * 클라이언트(수집)와 서버(route handler 재검증) 양쪽이 동일 SSOT 사용.
 * 순수함수 — DB/env import 0, 클라이언트 번들 안전.
 */

/** 알려진 동적 경로 규칙 — 더 구체적인 패턴이 먼저 (순서 의존). */
const DYNAMIC_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^\/products\/[^/]+\/checkout$/, "/products/[id]/checkout"],
  [/^\/products\/[^/]+$/, "/products/[id]"],
  [/^\/bookings\/[^/]+\/success$/, "/bookings/[id]/success"],
  [/^\/bookings\/[^/]+\/failed$/, "/bookings/[id]/failed"],
  [/^\/bookings\/[^/]+$/, "/bookings/[id]"],
];

/** 알려진 정적 경로. */
const STATIC_ROUTES: ReadonlySet<string> = new Set([
  "/",
  "/products",
  "/search",
  "/compare",
  "/login",
  "/signup",
  "/mypage",
  "/reviews/new",
]);

export const OTHER_BUCKET = "/(other)";

/** 저장 가능한 모든 route 템플릿 (서버 재검증 화이트리스트). */
export const ROUTE_TEMPLATES = [
  ...STATIC_ROUTES,
  "/products/[id]",
  "/products/[id]/checkout",
  "/bookings/[id]",
  "/bookings/[id]/success",
  "/bookings/[id]/failed",
  OTHER_BUCKET,
] as const;

const TEMPLATE_SET: ReadonlySet<string> = new Set(ROUTE_TEMPLATES);

/** pathname을 정규화 템플릿으로 접는다. 미상은 /(other). */
export function normalizeRoute(pathname: string): string {
  const path = pathname.split("?")[0].replace(/\/+$/, "") || "/";
  for (const [re, tpl] of DYNAMIC_RULES) {
    if (re.test(path)) return tpl;
  }
  if (STATIC_ROUTES.has(path)) return path;
  return OTHER_BUCKET;
}

/** 서버측 재검증 — 화이트리스트 밖 값은 /(other)로 강등(임의 문자열 저장 차단). */
export function coerceRouteTemplate(route: string): string {
  return TEMPLATE_SET.has(route) ? route : OTHER_BUCKET;
}
