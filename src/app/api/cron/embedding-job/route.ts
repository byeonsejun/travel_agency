/**
 * EmbeddingJob 배치 처리 cron worker 엔드포인트.
 *
 * 호출 패턴 (Vercel Cron / 외부 스케줄러):
 *   GET /api/cron/embedding-job
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * 동작:
 *   1) CRON_SECRET Bearer 토큰 가드
 *   2) processEmbeddingJobBatch(limit=5) 호출 — 3-layer 멱등성은 worker 내부 처리
 *   3) 결과 카운트 구조화 로그 + JSON 반환
 *
 * force-dynamic: ADR-0020 안전 도메인(cron). runtime=nodejs: worker가 Prisma 사용.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import { processEmbeddingJobBatch } from "@/shared/lib/embedding-job/worker";
import { logger } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  // CRON_SECRET 미설정이면 어떤 호출도 인증 불가 — production은 env superRefine
  // 으로 부팅 거부, dev는 호출 자체가 401로 떨어진다.
  if (!env.CRON_SECRET) return false;
  const header = req.headers.get("authorization");
  return header === `Bearer ${env.CRON_SECRET}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processEmbeddingJobBatch({ limit: 5 });

    logger.info("cron.embedding-job.run", {
      processed: result.processed,
      succeeded: result.succeeded,
      failed: result.failed,
      skipped: result.skipped,
    });

    return NextResponse.json(result);
  } catch (err) {
    // processEmbeddingJobBatch 내부 per-job catch가 핸들하지 못한 예상 밖의 오류
    // (예: DB connection 단절, provider 초기화 실패).
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      "cron.embedding-job.unexpected_error",
      err instanceof Error ? err : new Error(msg),
    );
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
