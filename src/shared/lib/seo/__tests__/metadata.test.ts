import { describe, expect, it } from "vitest";
import {
  DEFAULT_OG_IMAGE,
  HOME_DESCRIPTION,
  NOINDEX_METADATA,
  buildPageMetadata,
  buildRootMetadata,
  isPreviewDeployment,
} from "@/shared/lib/seo";

describe("isPreviewDeployment", () => {
  it("preview 일 때만 true", () => {
    expect(isPreviewDeployment("preview")).toBe(true);
    expect(isPreviewDeployment("production")).toBe(false);
    expect(isPreviewDeployment("development")).toBe(false);
    expect(isPreviewDeployment(undefined)).toBe(false);
  });
});

describe("buildRootMetadata", () => {
  it("운영: 정본 주소 · 제목 템플릿 · 색인 허용", () => {
    const m = buildRootMetadata(false);
    expect(new URL(String(m.metadataBase)).href).toBe("https://travel-agency-sooty-mu.vercel.app/");
    expect(m.title).toEqual({
      default: "Nextour — AI 패키지 여행 예약",
      template: "%s | Nextour",
    });
    expect(m.description).toBe(HOME_DESCRIPTION);
    expect(m.robots).toBeUndefined();
    expect(m.openGraph).toBeDefined();
    expect(m.openGraph).not.toHaveProperty("description");
    expect(m.openGraph).toMatchObject({ locale: "ko_KR" });
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("미리보기: noindex", () => {
    expect(buildRootMetadata(true).robots).toEqual({ index: false, follow: false });
  });
});

describe("buildPageMetadata", () => {
  it("제목이 있으면 title · canonical · OG · 트위터를 채운다", () => {
    const m = buildPageMetadata({ title: "여행 상품", description: "d", path: "/products" });
    expect(m.title).toBe("여행 상품");
    expect(m.description).toBe("d");
    expect(m.alternates?.canonical).toBe("/products");
    expect(m.openGraph).toMatchObject({
      title: "여행 상품 | Nextour",
      url: "/products",
      type: "website",
      siteName: "Nextour",
      images: [DEFAULT_OG_IMAGE],
    });
    expect(m.twitter).toMatchObject({ title: "여행 상품 | Nextour" });
    expect(m).not.toHaveProperty("robots");
  });

  it("제목이 없으면 title 키가 없고 OG 제목은 기본 제목", () => {
    const m = buildPageMetadata({ description: "d", path: "/" });
    expect(m).not.toHaveProperty("title");
    expect(m.openGraph).toMatchObject({ title: "Nextour — AI 패키지 여행 예약" });
  });

  it("image 를 주면 그 이미지, null 이면 기본 이미지", () => {
    const img = { url: "https://x.supabase.co/a.jpg", alt: "오사카" };
    expect(buildPageMetadata({ description: "d", path: "/p", image: img }).openGraph).toMatchObject({
      images: [img],
    });
    expect(buildPageMetadata({ description: "d", path: "/p", image: null }).openGraph).toMatchObject({
      images: [DEFAULT_OG_IMAGE],
    });
  });
});

describe("NOINDEX_METADATA", () => {
  it("색인과 링크 추적을 모두 막는다", () => {
    expect(NOINDEX_METADATA).toEqual({ robots: { index: false, follow: false } });
  });
});
