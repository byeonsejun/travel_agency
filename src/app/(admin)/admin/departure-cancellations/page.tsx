import Link from "next/link";
import { listCancellationBatches } from "@/entities/departure-cancellation";
import type { DepartureCancellationStatus } from "@/entities/departure-cancellation";

export const dynamic = "force-dynamic";

const BADGE: Record<DepartureCancellationStatus, string> = {
  PROCESSING: "bg-blue-100 text-blue-800",
  COMPLETED: "bg-green-100 text-green-800",
  PARTIALLY_FAILED: "bg-red-100 text-red-800",
};
const LABEL: Record<DepartureCancellationStatus, string> = {
  PROCESSING: "처리 중",
  COMPLETED: "완료",
  PARTIALLY_FAILED: "부분 실패",
};

export default async function CancellationBatchesPage() {
  const rows = await listCancellationBatches();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">출발 취소 배치</h1>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">취소 배치가 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3">출발일</th>
                <th className="px-4 py-3 text-center">상태</th>
                <th className="px-4 py-3 text-center">진척</th>
                <th className="px-4 py-3 text-center">실패</th>
                <th className="px-4 py-3">생성</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/departure-cancellations/${r.id}`}
                      className="font-medium text-indigo-700 hover:underline"
                    >
                      {r.departureLabel}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${BADGE[r.status]}`}>
                      {LABEL[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.immediateCancels + r.succeeded} / {r.totalBookings}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.failed > 0 ? (
                      <span className="font-semibold text-red-600">{r.failed}</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(r.createdAt).toLocaleString("ko-KR")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
