import Link from "next/link";
import type { ReviewStatus } from "@prisma/client";
import { listReviewsForAdmin } from "@/entities/review";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: "공개",
  HIDDEN: "숨김",
  REPORTED: "신고됨",
};
const STATUS_BADGE: Record<ReviewStatus, string> = {
  PUBLISHED: "bg-green-100 text-green-800",
  HIDDEN: "bg-gray-200 text-gray-700",
  REPORTED: "bg-amber-100 text-amber-800",
};
const FILTERS = [
  { value: "", label: "전체" },
  { value: "PUBLISHED", label: "공개" },
  { value: "HIDDEN", label: "숨김" },
  { value: "REPORTED", label: "신고됨" },
] as const;

function isStatus(s: string): s is ReviewStatus {
  return s === "PUBLISHED" || s === "HIDDEN" || s === "REPORTED";
}

function formatDate(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function AdminReviewsPage({ searchParams }: PageProps) {
  const { status } = await searchParams;
  const filter = status && isStatus(status) ? status : undefined;
  const page = await listReviewsForAdmin({ status: filter, limit: 30 });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-gray-900">리뷰 관리</h1>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Link
              key={f.value}
              href={
                f.value ? `/admin/reviews?status=${f.value}` : "/admin/reviews"
              }
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                active
                  ? "bg-red-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-left text-gray-500">
            <tr>
              <th className="px-4 py-2">상품</th>
              <th className="px-4 py-2">작성자</th>
              <th className="px-4 py-2">별점</th>
              <th className="px-4 py-2">사진</th>
              <th className="px-4 py-2">상태</th>
              <th className="px-4 py-2">작성일</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {page.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">
                  표시할 리뷰가 없습니다.
                </td>
              </tr>
            ) : (
              page.items.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="max-w-xs truncate px-4 py-2">
                    {r.productTitle}
                  </td>
                  <td className="px-4 py-2">{r.authorDisplayName}</td>
                  <td className="px-4 py-2">{r.rating}점</td>
                  <td className="px-4 py-2">{r.photoCount}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[r.status]}`}
                    >
                      {STATUS_LABELS[r.status]}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-gray-500">
                    {formatDate(r.createdAt)}
                  </td>
                  <td className="px-4 py-2">
                    <Link
                      href={`/admin/reviews/${r.id}`}
                      className="text-red-600 hover:underline"
                    >
                      상세
                    </Link>
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
