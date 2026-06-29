import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RenderedEmail } from "../render";

// env(서버 시크릿 parse)와 nodemailer(실 SMTP 연결)를 격리해 transport 분기만 검증한다.
const { envMock, sendMailMock, createTransportMock } = vi.hoisted(() => {
  const envMock: { GMAIL_USER?: string; GMAIL_APP_PASSWORD?: string } = {};
  const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test" });
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { envMock, sendMailMock, createTransportMock };
});

vi.mock("@/shared/lib/env", () => ({ env: envMock }));
vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

const rendered: RenderedEmail = {
  subject: "[Nextour] 로그인 링크",
  html: "<a>로그인하기</a>",
  text: "https://nextour.example/auth/callback?token=ML_TEST_TOKEN",
};

describe("sendMagicLinkEmail", () => {
  beforeEach(() => {
    // 모듈 스코프 transporter 싱글턴 + mock 호출 기록 초기화.
    vi.resetModules();
    vi.clearAllMocks();
    envMock.GMAIL_USER = undefined;
    envMock.GMAIL_APP_PASSWORD = undefined;
  });

  it("GMAIL 자격증명 미설정 → 명확한 에러로 throw, SMTP 호출 0", async () => {
    const { sendMagicLinkEmail } = await import("../smtp");
    await expect(
      sendMagicLinkEmail("user@example.com", rendered),
    ).rejects.toThrow(/GMAIL_USER/);
    // env 가드가 transport 생성 전에 차단 — 실 SMTP 연결 시도 없음.
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("자격증명 설정 → Gmail service transport 생성 + brandedFrom 발신자로 발송", async () => {
    envMock.GMAIL_USER = "nextour.bot@gmail.com";
    envMock.GMAIL_APP_PASSWORD = "abcd efgh ijkl mnop";
    const { sendMagicLinkEmail } = await import("../smtp");

    await sendMagicLinkEmail("user@example.com", rendered);

    expect(createTransportMock).toHaveBeenCalledWith({
      service: "gmail",
      auth: { user: "nextour.bot@gmail.com", pass: "abcd efgh ijkl mnop" },
    });
    // 발신자는 인증 계정으로 강제되며 Nextour 표시명으로 브랜딩.
    expect(sendMailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "Nextour <nextour.bot@gmail.com>",
        to: "user@example.com",
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
    );
  });
});
