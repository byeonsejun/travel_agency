import Link from "next/link";

export default function AdminBookingNotFound() {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-12 text-center">
      <h1 className="text-xl font-bold text-gray-900">
        예약을 찾을 수 없습니다
      </h1>
      <p className="mt-2 text-sm text-gray-500">
        존재하지 않는 예약 ID입니다.
      </p>
      <Link
        href="/admin/bookings"
        className="mt-6 inline-block rounded-lg bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800"
      >
        예약 목록으로
      </Link>
    </div>
  );
}
