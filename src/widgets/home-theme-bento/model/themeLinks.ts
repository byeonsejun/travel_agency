/**
 * 테마별 기획전(테마 벤토) 데이터.
 *
 * 색은 데이터에 박지 않는다 — 타일의 비주얼은 (a) `image` 사진 + (b) 컴포넌트의
 * 토큰 기반 오버레이에서만 나온다(클린 블루 시스템). 과거의 하드코딩 hex 그라데이션
 * (코랄/틸/보라)은 제거됨.
 *
 * `image` 는 교체용 목업 슬롯이다:
 *  - 비어 있으면(undefined) 컴포넌트가 토큰 기반 placeholder 블록을 렌더한다.
 *  - 여기에 이미지 URL 을 넣으면 그 타일이 곧바로 next/image 사진 타일로 전환된다.
 *    (예: image: "/themes/honeymoon.jpg" — public 자산 또는 remotePatterns 등록 원격 URL)
 */
export type ThemeTile = {
  label: string;
  sub: string;
  query: string;
  /** 교체용 이미지 슬롯. 비우면 토큰 placeholder, 채우면 사진 타일. */
  image?: string;
};

export function buildThemeHref(query: string): string {
  return `/search?q=${encodeURIComponent(query)}`;
}

export const THEME_TILES: ThemeTile[] = [
  { sub: "가족과 함께", label: "키즈 동반 추천", query: "가족여행" },
  { sub: "단둘이", label: "허니문 특집", query: "허니문" },
  { sub: "혼자라서 좋아", label: "나홀로 여행", query: "나홀로 여행" },
  { sub: "짧고 굵게", label: "주말 근거리", query: "주말 근거리" },
];
