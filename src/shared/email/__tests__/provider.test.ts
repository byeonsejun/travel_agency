import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  env: {
    NODE_ENV: "test",
    RESEND_API_KEY: "test_dummy",
    RESEND_FROM_EMAIL: "Nextour <no@reply.test>",
  },
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({ emails: { send: mocks.send } })),
}));
vi.mock("@/shared/lib/env", () => ({ env: mocks.env }));
vi.mock("@/shared/lib/observability", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

import { sendEmail } from "../provider";

describe("sendEmail dev 폴백", () => {
  beforeEach(() => vi.clearAllMocks());

  it("NODE_ENV!=production 이면 Resend 미호출, dev id 반환", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const res = await sendEmail({
      to: "qa@nextour.test",
      subject: "s",
      html: "<p>h</p>",
      text: "h",
      idempotencyKey: "booking-confirmation:clbk1",
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(res.id).toBe("dev-booking-confirmation:clbk1");
    logSpy.mockRestore();
  });
});
