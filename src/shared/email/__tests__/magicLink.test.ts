import { describe, it, expect } from "vitest";
import { brandedFrom, renderMagicLinkEmail } from "../magicLink";

describe("renderMagicLinkEmail", () => {
  const url = "https://nextour.example/auth/callback?token=ML_TEST_TOKEN";

  it("브랜드 제목 — raw URL/host 미노출", async () => {
    const out = await renderMagicLinkEmail(url);
    expect(out.subject).toBe("[Nextour] 로그인 링크");
    expect(out.subject).not.toContain("http");
  });

  it("매직링크 URL을 가공 없이 버튼+평문 fallback에 연결", async () => {
    const out = await renderMagicLinkEmail(url);
    // html(버튼 href + 평문 링크), text(평문 fallback) 모두 동일 URL 포함
    expect(out.html).toContain("token=ML_TEST_TOKEN");
    expect(out.text).toContain(url);
    expect(out.html).toContain("로그인하기");
  });

  it("브랜드 블루 CTA + 24시간 만료 안내 + 보안 문구", async () => {
    const out = await renderMagicLinkEmail(url);
    expect(out.html).toContain("#0f63ff"); // 브랜드 블루
    expect(out.html).toContain("24시간 동안");
    expect(out.html).toContain("요청하지 않았다면");
    expect(out.html).toContain("Nextour");
  });
});

describe("brandedFrom", () => {
  it("순수 주소는 Nextour 표시명으로 감싼다", () => {
    expect(brandedFrom("onboarding@resend.dev")).toBe(
      "Nextour <onboarding@resend.dev>",
    );
  });

  it("이미 표시명이 있으면 그대로 둔다", () => {
    expect(brandedFrom("Nextour <noreply@nextour.example>")).toBe(
      "Nextour <noreply@nextour.example>",
    );
  });
});
