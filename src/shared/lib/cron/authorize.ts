import type { NextRequest } from "next/server";
import { env } from "@/shared/lib/env";

// 공통 cron Bearer 가드 (기존 3개 라우트의 isAuthorized 복제 제거).
// CRON_SECRET 미설정이면 어떤 호출도 거부 — production은 env superRefine으로
// 부팅 거부, dev는 호출이 401로 떨어진다.
export function isCronAuthorized(req: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  return req.headers.get("authorization") === `Bearer ${env.CRON_SECRET}`;
}
