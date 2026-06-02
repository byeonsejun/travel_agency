import Link from "next/link";
import { notFound } from "next/navigation";
import { getCancellationBatchDetail } from "@/entities/departure-cancellation";
import { retryBatchRefundAction } from "@/features/admin-departure-cancel";
import type { RefundJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const JOB_BADGE: Record<RefundJobStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

type PageProps = { params: Promise<{ id: string }> };

export default async function BatchDetailPage({ params }: PageProps) {
  const { id } = await params;
  const batch = await getCancellationBatchDetail(id);
  if (!batch) notFound();

  const hasFailed = batch.jobs.some((j) => j.status === "FAILED");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/departure-cancellations" className="text-sm text-gray-500 hover:text-gray-700">
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">취소 배치 상세</h1>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
          {batch.status}
        </span>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 text-sm">
        <p>
          총 예약 {batch.totalBookings}건 · 즉시 취소(미결제) {batch.immediateCancels}건 · 환불 job{" "}
          {batch.jobs.length}건
        </p>
        {batch.reason && <p className="mt-1 text-gray-500">사유: {batch.reason}</p>}
      </div>

      {hasFailed && (
        <form action={retryBatchRefundAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <button
            type="submit"
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
          >
            실패 건 전체 재시도
          </button>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-gray-50 text-left text-gray-600">
              <th className="px-4 py-3">예약 ID</th>
              <th className="px-4 py-3 text-center">환불 상태</th>
              <th className="px-4 py-3 text-center">시도</th>
              <th className="px-4 py-3">오류</th>
              <th className="px-4 py-3 text-center">재시도</th>
            </tr>
          </thead>
          <tbody>
            {batch.jobs.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-xs text-gray-400">
                  환불 job 없음 (전부 미결제 즉시 취소).
                </td>
              </tr>
            ) : (
              batch.jobs.map((j) => (
                <tr key={j.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-mono text-xs">{j.bookingId.slice(-8)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_BADGE[j.status]}`}>
                      {j.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">{j.attempts}</td>
                  <td className="px-4 py-3 text-xs text-red-600">
                    {j.lastError ? j.lastError.slice(0, 80) : "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {j.status === "FAILED" && (
                      <form action={retryBatchRefundAction}>
                        <input type="hidden" name="batchId" value={batch.id} />
                        <input type="hidden" name="jobId" value={j.id} />
                        <button
                          type="submit"
                          className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                        >
                          재시도
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
