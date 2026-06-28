import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * 매직링크 완료 플로우 회귀 테스트.
 *
 * 버그: middleware 의 "인증된 사용자를 /login 에서 callbackUrl 로 돌려보내기"
 * 규칙이 `pathname.startsWith("/login")` 이라, 매직링크 검증 직후 인증 상태로
 * 진입하는 `/login/success`(창 닫기 안내 페이지)까지 홈으로 바운스했다.
 * 결과: 새 탭이 success 페이지 대신 홈으로 가 window.close() 가 실행되지 않음.
 *
 * 규칙은 *로그인 폼*(`/login` 정확히 일치)에만 적용되어야 하고, 완료 플로우
 * 하위 경로(`/login/success`, `/login/verify`)는 통과시켜야 한다.
 */
// 세션은 이제 middleware 가 next-auth/jwt 의 getToken 으로 *읽기 전용* 디코드한다
// (auth() 래퍼의 rolling 쿠키 재발급 제거 — 로그아웃 경합 버그 수정). 인증 사용자
// 시나리오이므로 getToken 이 디코드된 JWT payload(id/role)를 반환하도록 mock.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async () => ({ id: "user_1", role: "USER" })),
}));

type MiddlewareFn = (req: NextRequest) => Promise<Response> | Response;

function buildAuthedReq(url: string): NextRequest {
  const req = new NextRequest(url);
  Object.defineProperty(req, "nextUrl", {
    value: new URL(url),
    configurable: true,
  });
  return req;
}

async function loadMiddleware(): Promise<MiddlewareFn> {
  vi.resetModules();
  return (await import("../middleware")).middleware as MiddlewareFn;
}

describe("middleware — 인증 사용자 /login 바운스 범위 (매직링크 완료 플로우 보존)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("인증 사용자가 `/login`(폼)에 진입하면 callbackUrl 로 redirect", async () => {
    const middleware = await loadMiddleware();
    const res = await middleware(
      buildAuthedReq("http://localhost:3000/login?callbackUrl=%2Fmypage"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/mypage");
  });

  it("인증 사용자의 `/login/success` 는 바운스되지 않고 통과한다", async () => {
    const middleware = await loadMiddleware();
    const res = await middleware(
      buildAuthedReq("http://localhost:3000/login/success?callbackUrl=%2F"),
    );
    // redirect 가 아니어야 함 — success 페이지(창 닫기 안내)가 렌더되어야 한다.
    expect(res.headers.get("location")).toBeNull();
  });

  it("인증 사용자의 `/login/verify` 도 바운스되지 않고 통과한다", async () => {
    const middleware = await loadMiddleware();
    const res = await middleware(
      buildAuthedReq("http://localhost:3000/login/verify?callbackUrl=%2F&email=a%40b.com"),
    );
    expect(res.headers.get("location")).toBeNull();
  });
});
