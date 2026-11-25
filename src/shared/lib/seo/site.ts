// 이 모듈은 env 를 import 하므로 @/shared/lib/seo 는 서버 전용이다. 'use client' 파일에서 import 하지 않는다.
import { env } from "@/shared/lib/env";

// 정본(운영) 주소. env 로 받지 않고 상수로 둔다 — 미리보기 배포에서도 canonical 이
// 운영을 가리켜야 해서, 배포마다 달라지는 값을 쓰면 안 된다.
export const SITE_URL = "https://travel-agency-sooty-mu.vercel.app";
export const SITE_NAME = "Nextour";
export const SITE_DEFAULT_TITLE = "Nextour — AI 패키지 여행 예약";
export const HOME_DESCRIPTION =
  "조건에 딱 맞는 여행을 AI가 찾아드립니다. 목적지·날짜·인원만 입력하면, 나머지는 Nextour가.";

export const DEFAULT_OG_IMAGE = {
  url: "/hero-travel.jpg",
  width: 1600,
  height: 1064,
  alt: "Nextour",
} as const;

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path}`;
}

// 미리보기 판정은 VERCEL_ENV === "preview" 만. 로컬 · 운영은 색인을 허용한다.
export function isPreviewDeployment(vercelEnv: string | undefined = env.VERCEL_ENV): boolean {
  return vercelEnv === "preview";
}
