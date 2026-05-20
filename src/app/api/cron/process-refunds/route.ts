/**
 * RefundJob backoff 큐의 cron worker.
 *
 * 호출 패턴 (Vercel Cron / 외부 스케줄러):
 *   GET /api/cron/process-refunds
 *   Authorization: Bearer ${CRON_SECRET}
 *
 * 동작:
 *   1) PENDING (nextRunAt 도래) + stuck IN_PROGRESS (10분 초과) 후보 N개 조회
 *   2) 각 job을 try-catch로 *격리* 실행 — 한 job 실패가 다른 job 진행 막지 않음
 *   3) retryRefundJob 내부에서 atomic CAS claim → Phase 2(PG) → Phase 3(DB Tx)
 *      → booking transition. 실패 시 backoff PENDING 재적재.
 *
 * 단일 worker 가정 안 함 — atomic CAS로 다중 instance 동시 실행 안전.
 */

import { NextRequest, NextResponse } from "next/server";
import { env } from "@/shared/lib/env";
import {
  listDueRefundJobs,
  retryRefundJob,
  type RetryRefundResult,
} from "@/entities/payment";
import { logger, metrics } from "@/shared/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_JOBS_PER_RUN = 10;

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

  const due = await listDueRefundJobs(MAX_JOBS_PER_RUN);
  if (due.length === 0) {
    return NextResponse.json({
      processed: 0,
      results: [] as RetryRefundResult[],
    });
  }

  const results: (RetryRefundResult | { type: "error"; jobId: string; error: string })[] = [];

  for (const job of due) {
    try {
      const result = await retryRefundJob(job.id);
      results.push(result);
    } catch (err) {
      // 격리: 한 job의 예측 못한 예외가 루프 중단을 일으키지 않게.
      // retryRefundJob 내부에서 이미 PaymentError를 처리하므로 이 catch는
      // 진짜 예상 못한 에러(DB connection 등) 전용.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        "cron.refund.job_unexpected_error",
        err instanceof Error ? err : new Error(msg),
        { jobId: job.id }
      );
      metrics.incr("cron.refund.unexpected_error");
      results.push({ type: "error", jobId: job.id, error: msg });
    }
  }

  // 요약 카운트 — 운영자가 응답만 보고 처리 결과를 파악
  const summary = results.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );

  logger.info("cron.refund.run", { processed: results.length, summary });

  return NextResponse.json({
    processed: results.length,
    summary,
    results,
  });
}
