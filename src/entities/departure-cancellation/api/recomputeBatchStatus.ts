import type { DepartureCancellationStatus } from "@prisma/client";
import { db } from "@/shared/lib/db";

/**
 * 배치 status를 자식 RefundJob(cancellationBatchId) 상태에서 파생·갱신. [ADR-0028]
 *
 * 파생 규칙 (FAILED 우선):
 *   1) 하나라도 FAILED  → PARTIALLY_FAILED  (admin 재시도 필요 — 즉시 가시화)
 *   2) 모두 SUCCEEDED   → COMPLETED         (job 0건=미결제만 있던 배치도 vacuous COMPLETED)
 *   3) 그 외(PENDING/IN_PROGRESS 존재) → PROCESSING
 *
 * RefundJob 상태가 SSOT, 배치 status는 그 투영.
 * entity 간 import 0 — shared db로 RefundJob 테이블만 직접 조회(payment 슬라이스 미import).
 */
export async function recomputeBatchStatus(
  batchId: string,
): Promise<DepartureCancellationStatus> {
  const jobs = await db.refundJob.findMany({
    where: { cancellationBatchId: batchId },
    select: { status: true },
  });

  const hasFailed = jobs.some((j) => j.status === "FAILED");
  const allSucceeded = jobs.every((j) => j.status === "SUCCEEDED"); // [] → true

  const status: DepartureCancellationStatus = hasFailed
    ? "PARTIALLY_FAILED"
    : allSucceeded
      ? "COMPLETED"
      : "PROCESSING";

  await db.departureCancellation.update({
    where: { id: batchId },
    data: { status },
  });
  return status;
}
