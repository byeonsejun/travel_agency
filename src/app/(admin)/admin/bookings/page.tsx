import Link from "next/link";
import {
  listAllBookings,
  BookingStatusBadge,
} from "@/entities/booking";

// admin route는 항상 신선 (session·권한 검증 + 운영 즉시성)
export const dynamic = "force-dynamic";

function formatDate(d: Date): string {
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export default async function AdminBookingsPage() {
  // layout이 ADMIN role 가드 이미 통과
  const { items, total } = await listAllBookings({ limit: 50 });

  return (
    <div>
      <div className="mb-6 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold text-gray-900">예약 관리</h1>
        <span className="text-sm text-gray-500">
          최근 50건 / 총 {total.toLocaleString("ko-KR")}건
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-12 text-center text-gray-500">
          등록된 예약이 없습니다.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-left">
              <tr>
                <th className="px-4 py-3 font-medium text-gray-700">예약 ID</th>
                <th className="px-4 py-3 font-medium text-gray-700">상품</th>
                <th className="px-4 py-3 font-medium text-gray-700">출발일</th>
                <th className="px-4 py-3 font-medium text-gray-700">고객</th>
                <th className="px-4 py-3 text-right font-medium text-gray-700">
                  금액
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  상태
                </th>
                <th className="px-4 py-3 text-center font-medium text-gray-700">
                  관리
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((b) => {
                const pax = b.adultCount + b.childCount + b.infantCount;
                return (
                  <tr
                    key={b.id}
                    className="border-b border-gray-100 transition-colors hover:bg-gray-50 last:border-b-0"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-gray-600">
                      ...{b.id.slice(-10)}
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      <div className="font-medium">
                        {b.departure.product.title}
                      </div>
                      <div className="text-xs text-gray-500">
                        {b.createdAt.toLocaleDateString("ko-KR")} 예약 · 인원{" "}
                        {pax}명
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      <div>{formatDate(b.departure.departureDate)}</div>
                      <div className="text-xs text-gray-500">
                        ~ {formatDate(b.departure.returnDate)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      <div className="text-sm">
                        {b.user.name ?? b.user.email ?? "(no name)"}
                      </div>
                      {b.user.email && b.user.name && (
                        <div className="text-xs text-gray-500">
                          {b.user.email}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {b.totalPrice.toLocaleString("ko-KR")}원
                    </td>
                    <td className="px-4 py-3 text-center">
                      <BookingStatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Link
                        href={`/admin/bookings/${b.id}`}
                        className="inline-block rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                      >
                        상세
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
