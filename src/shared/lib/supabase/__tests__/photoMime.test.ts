import { describe, it, expect, vi, afterEach } from "vitest";
import { reviewPhotoPublicUrl } from "../photoMime";

// env(@/shared/lib/env)를 모킹하지 않는다 — photoMime은 client-safe라
// process.env.NEXT_PUBLIC_SUPABASE_URL을 직접 읽는다(ADR-0029). 실제 env를
// stub해 client 번들 누수(env.ts server parse)를 테스트가 다시 가리지 않게 한다.
describe("reviewPhotoPublicUrl", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("버킷·path 를 결합한 public object URL 을 만든다", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://proj.supabase.co");
    expect(reviewPhotoPublicUrl("review-photos/abc/0.webp")).toBe(
      "https://proj.supabase.co/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });

  it("env 미설정 시 빈 prefix 로 fallback (로컬/테스트)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(reviewPhotoPublicUrl("review-photos/abc/0.webp")).toBe(
      "/storage/v1/object/public/product-images/review-photos/abc/0.webp",
    );
  });
});
