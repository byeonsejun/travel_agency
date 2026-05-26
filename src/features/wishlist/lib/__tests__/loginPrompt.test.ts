import { describe, it, expect } from "vitest";
import {
  LOGIN_PROMPT_MESSAGE,
  buildResumeCallbackUrl,
} from "../loginPrompt";

describe("LOGIN_PROMPT_MESSAGE", () => {
  it("'로그인' 문자열 포함 (스모크)", () => {
    expect(LOGIN_PROMPT_MESSAGE).toContain("로그인");
  });
});

describe("buildResumeCallbackUrl()", () => {
  it("기본 형태: /api/wishlist/resume?productId=...&returnTo=...", () => {
    const url = buildResumeCallbackUrl("p1", "/products");
    expect(url).toBe(
      "/api/wishlist/resume?productId=p1&returnTo=%2Fproducts",
    );
  });

  it("쿼리스트링이 있는 returnTo 도 정확히 인코딩", () => {
    const url = buildResumeCallbackUrl("p1", "/products?page=2&sort=new");
    // & 와 ? 가 모두 인코딩되어 callbackUrl 파싱이 깨지지 않아야 함
    expect(url).toBe(
      "/api/wishlist/resume?productId=p1&returnTo=%2Fproducts%3Fpage%3D2%26sort%3Dnew",
    );
  });

  it("productId 에 특수문자가 와도 인코딩", () => {
    const url = buildResumeCallbackUrl("a/b c", "/x");
    expect(url).toContain("productId=a%2Fb%20c");
  });
});
