import type { DepartureCancellation, RefundJob } from "@prisma/client";

export type { DepartureCancellationStatus } from "@prisma/client";

// admin 배치 목록 행 — departure 라벨 + RefundJob 상태 파생 카운트.
export type CancellationBatchRow = DepartureCancellation & {
  departureLabel: string; // "상품명 · 출발일"
  succeeded: number;
  failed: number;
  pending: number; // PENDING + IN_PROGRESS
};

// admin 배치 상세 — 자식 RefundJob 목록 동반.
export type CancellationBatchDetail = DepartureCancellation & {
  jobs: Pick<RefundJob, "id" | "bookingId" | "status" | "attempts" | "lastError">[];
};
