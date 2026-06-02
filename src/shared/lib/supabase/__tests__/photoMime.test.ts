import { describe, it, expect, vi } from "vitest";

vi.mock("@/shared/lib/env", () => ({
  env: { NEXT_PUBLIC_SUPABASE_URL: "https://proj.supabase.co" },
}));

import { reviewPhotoPublicUrl } from "../photoMime";

describe("reviewPhotoPublicUrl", () => {
  it("버킷·path 를 결합한 public object URL 을 만든다", () => {
    expect(reviewPhotoPublicUrl("review-photos/abc/0.webp")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });

  it("env 미설정 시 빈 prefix 로 fallback (로컬/테스트)", async () => {
    vi.resetModules();
    vi.doMock("@/shared/lib/env", () => ({ env: {} }));
    const { reviewPhotoPublicUrl: fn } = await import("../photoMime");
    expect(fn("review-photos/abc/0.webp")).toBe(
      "/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });
});
