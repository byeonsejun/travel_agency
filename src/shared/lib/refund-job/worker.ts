/**
 * RefundJob backoff 큐 워커 — process-refunds 라우트에서 추출.
 * email/embedding 워커와 동형(shared/lib/*-job/worker.ts). 백그라운드 워커
 * 레이어의 FSD 예외로 @/entities/* 직접 import 허용(ADR-0026/0030 선례).
 */
import {
  listDueRefundJobs,
  retryRefundJob,
  type RetryRefundResult,
} from "@/entities/payment";
import { recomputeBatchStatus } from "@/entities/departure-cancellation";
import { db } from "@/shared/lib/db";
import { logger, metrics } from "@/shared/lib/observability";

export interface RefundBatchResult {
  processed: number;
  summary: Record<string, number>;
  results: (RetryRefundResult | { type: "error"; jobId: string; error: string })[];
}

export async function processRefundJobBatch(opts: {
  limit: number;
}): Promise<RefundBatchResult> {
  const due = await listDueRefundJobs(opts.limit);
  if (due.length === 0) {
    return { processed: 0, summary: {}, results: [] };
  }

  const results: RefundBatchResult["results"] = [];
  for (const job of due) {
    try {
      results.push(await retryRefundJob(job.id));
    } catch (err) {
      // 격리: 한 job의 예측 못한 예외가 루프를 막지 않게. retryRefundJob 내부는
      // 이미 PaymentError 처리 → 이 catch는 진짜 예상 밖(DB 단절 등) 전용.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        "cron.refund.job_unexpected_error",
        err instanceof Error ? err : new Error(msg),
        { jobId: job.id },
      );
      metrics.incr("cron.refund.unexpected_error");
      results.push({ type: "error", jobId: job.id, error: msg });
    }
  }

  // 처리된 job들이 속한 출발-취소 배치를 distinct하게 모아 status 재계산. [ADR-0028]
  // null(단일 사용자 환불)은 skip. recompute 실패가 응답을 막지 않도록 격리(.catch).
  const processedIds = due.map((j) => j.id);
  const processedJobs = await db.refundJob.findMany({
    where: { id: { in: processedIds } },
    select: { cancellationBatchId: true },
  });
  const batchIds = [
    ...new Set(
      processedJobs
        .map((j) => j.cancellationBatchId)
        .filter((x): x is string => x !== null),
    ),
  ];
  for (const batchId of batchIds) {
    await recomputeBatchStatus(batchId).catch((err) => {
      logger.error(
        "cron.refund.batch_recompute_failed",
        err instanceof Error ? err : new Error(String(err)),
        { batchId },
      );
    });
  }

  const summary = results.reduce(
    (acc, r) => {
      acc[r.type] = (acc[r.type] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  logger.info("cron.refund.run", { processed: results.length, summary });
  return { processed: results.length, summary, results };
}
