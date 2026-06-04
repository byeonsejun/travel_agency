import { db } from "@/shared/lib/db";
import type { CancellationBatchRow, CancellationBatchDetail } from "../model/types";

// admin 배치 목록 — 최신순. departure 라벨 + RefundJob 상태 파생 카운트.
export async function listCancellationBatches(): Promise<CancellationBatchRow[]> {
  const rows = await db.departureCancellation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      departure: {
        select: { departureDate: true, product: { select: { title: true } } },
      },
      refundJobs: { select: { status: true } },
    },
  });

  return rows.map((r) => {
    const succeeded = r.refundJobs.filter((j) => j.status === "SUCCEEDED").length;
    const failed = r.refundJobs.filter((j) => j.status === "FAILED").length;
    const pending = r.refundJobs.filter(
      (j) => j.status === "PENDING" || j.status === "IN_PROGRESS",
    ).length;
    // refundJobs/departure는 파생에만 쓰고 행 페이로드에서 제외.
    const { refundJobs: _jobs, departure, ...batch } = r;
    void _jobs;
    return {
      ...batch,
      departureLabel: `${departure.product.title} · ${new Date(
        departure.departureDate,
      ).toLocaleDateString("ko-KR")}`,
      succeeded,
      failed,
      pending,
    };
  });
}

// admin 배치 상세 — 자식 RefundJob 목록(재시도 UI용).
export async function getCancellationBatchDetail(
  id: string,
): Promise<CancellationBatchDetail | null> {
  const row = await db.departureCancellation.findUnique({
    where: { id },
    include: {
      refundJobs: {
        select: { id: true, bookingId: true, status: true, attempts: true, lastError: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!row) return null;
  const { refundJobs, ...batch } = row;
  return { ...batch, jobs: refundJobs };
}
