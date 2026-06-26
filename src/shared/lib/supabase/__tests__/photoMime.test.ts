import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  reviewPhotoPublicUrl,
  buildHeroSeedPublicUrl,
  HERO_SEED_PREFIX,
  buildBucketPublicUrl,
  buildThemeImageUrl,
  THEME_IMAGE_PREFIX,
} from "../photoMime";

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

describe("buildHeroSeedPublicUrl", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co"));
  afterEach(() => vi.unstubAllEnvs());
  it("결정적 public URL 을 만든다", () => {
    expect(buildHeroSeedPublicUrl("osaka-kyoto")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/product-images/product-hero/seed/osaka-kyoto.jpg",
    );
  });
  it("HERO_SEED_PREFIX 가 경로에 포함된다", () => {
    expect(buildHeroSeedPublicUrl("x")).toContain(HERO_SEED_PREFIX);
  });

  // ★ 회귀 가드 — prefix 인자화 래퍼 리팩터가 상품 URL 을 바꾸지 않음을 고정.
  it("리팩터 후에도 buildBucketPublicUrl(HERO_SEED_PREFIX, slug) 와 동일 출력", () => {
    expect(buildHeroSeedPublicUrl("osaka-weekend")).toBe(
      buildBucketPublicUrl(HERO_SEED_PREFIX, "osaka-weekend"),
    );
    expect(buildHeroSeedPublicUrl("osaka-weekend")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/product-images/product-hero/seed/osaka-weekend.jpg",
    );
  });
});

describe("buildBucketPublicUrl (prefix 인자화 빌더)", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co"));
  afterEach(() => vi.unstubAllEnvs());

  it("임의 prefix·slug 를 결정적 public URL 로 조립", () => {
    expect(buildBucketPublicUrl("product-hero/themes", "family")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/product-images/product-hero/themes/family.jpg",
    );
  });

  it("env 미설정 시 빈 prefix fallback (상대경로)", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(buildBucketPublicUrl("product-hero/themes", "solo")).toBe(
      "/storage/v1/object/public/product-images/product-hero/themes/solo.jpg",
    );
  });
});

describe("buildThemeImageUrl", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://demo.supabase.co"));
  afterEach(() => vi.unstubAllEnvs());

  it("테마 prefix(product-hero/themes) 로 URL 생성", () => {
    expect(buildThemeImageUrl("honeymoon")).toBe(
      "https://demo.supabase.co/storage/v1/object/public/product-images/product-hero/themes/honeymoon.jpg",
    );
  });

  it("THEME_IMAGE_PREFIX 가 경로에 포함되고 seed prefix 와 다르다", () => {
    expect(buildThemeImageUrl("weekend")).toContain(THEME_IMAGE_PREFIX);
    expect(THEME_IMAGE_PREFIX).not.toBe(HERO_SEED_PREFIX);
  });
});
