import type { Metadata } from "next";
import {
  DEFAULT_OG_IMAGE,
  HOME_DESCRIPTION,
  SITE_DEFAULT_TITLE,
  SITE_NAME,
  SITE_URL,
} from "./site";

export const NOINDEX_METADATA: Metadata = {
  robots: { index: false, follow: false },
};

export function buildRootMetadata(preview: boolean): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: SITE_DEFAULT_TITLE, template: `%s | ${SITE_NAME}` },
    description: HOME_DESCRIPTION,
    // 레이아웃 openGraph 에는 description 을 넣지 않는다. 자식 페이지가 openGraph 를
    // 통째로 덮어쓰지 않는 한 상속되므로, 넣으면 모든 공유 카드에 홈 설명이 박힌다.
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: { card: "summary_large_image" },
    ...(preview ? NOINDEX_METADATA : {}),
  };
}

interface PageMetadataInput {
  title?: string;
  description: string;
  path: string;
  image?: { url: string; alt: string } | null;
}

// robots 는 일부러 내보내지 않는다. 미리보기 배포의 noindex(루트)를 덮어쓰지 않기 위해서다.
export function buildPageMetadata({ title, description, path, image }: PageMetadataInput): Metadata {
  // Next 의 title template 은 openGraph · twitter 에는 적용되지 않아 직접 붙인다.
  const shareTitle = title ? `${title} | ${SITE_NAME}` : SITE_DEFAULT_TITLE;
  const images = [image ?? DEFAULT_OG_IMAGE];
  return {
    ...(title ? { title } : {}),
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "ko_KR",
      title: shareTitle,
      description,
      url: path,
      images,
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images,
    },
  };
}
