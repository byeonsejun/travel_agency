/**
 * rum-cleanup worker — WebVitalEvent 30일 보존 정리.
 * 시간 기준 deleteMany라 멱등(이미 삭제된 행은 no-op, 부분 실패 시 다음 tick 수렴).
 * cron 디스패처에서 호출(ADR-0005). 외부 IO 없음 — DB만.
 */
import { db } from "@/shared/lib/db";

const RETENTION_DAYS = 30;

export interface RumCleanupResult {
  deleted: number;
}

export async function processRumCleanup(): Promise<RumCleanupResult> {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await db.webVitalEvent.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });
  return { deleted: count };
}
