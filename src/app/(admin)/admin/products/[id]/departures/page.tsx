import Link from "next/link";
import { listAdminDepartures, DEPARTURE_STATUS_LABEL } from "@/entities/departure";
import type { DepartureStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

const STATUS_BADGE: Record<DepartureStatus, string> = {
  SCHEDULED: "bg-blue-100 text-blue-800",
  CONFIRMED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-700",
  CANCELED: "bg-red-100 text-red-800",
};

function fmt(d: Date) {
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function AdminDeparturesPage({ params }: PageProps) {
  const { id: productId } = await params;
  const rows = await listAdminDepartures(productId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href={`/admin/products/${productId}/edit`}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            ← 상품
          </Link>
          <h1 className="text-2xl font-bold text-gray-900">출발일 관리</h1>
        </div>
        <Link
          href={`/admin/products/${productId}/departures/new`}
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + 출발일 생성
        </Link>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-gray-400">출발일이 없습니다.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-gray-50 text-left text-gray-600">
                <th className="px-4 py-3">출발 / 귀국</th>
                <th className="px-4 py-3 text-right">성인 / 아동</th>
                <th className="px-4 py-3 text-center">좌석</th>
                <th className="px-4 py-3 text-center">minPax</th>
                <th className="px-4 py-3 text-center">상태</th>
                <th className="px-4 py-3 text-center">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {fmt(d.departureDate)} ~ {fmt(d.returnDate)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {d.priceAdult.toLocaleString("ko-KR")} /{" "}
                    {d.priceChild.toLocaleString("ko-KR")}원
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.bookedSeats}/{d.capacity}
                    {d.bookedSeats >= d.minPax && (
                      <span className="ml-1 rounded bg-green-50 px-1.5 text-xs text-green-700">
                        확정가능
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-600">{d.minPax}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[d.status]}`}
                    >
                      {DEPARTURE_STATUS_LABEL[d.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Link
                      href={`/admin/products/${productId}/departures/${d.id}/edit`}
                      className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                    >
                      편집
                    </Link>
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
