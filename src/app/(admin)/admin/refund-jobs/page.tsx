import Link from "next/link";
import { summarizeRefundJobs, listRefundJobs } from "@/entities/payment";
import type { RefundJobRow } from "@/entities/payment";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

const FILTER_OPTIONS = [
  { value: "", label: "전체" },
  { value: "PENDING", label: "대기" },
  { value: "IN_PROGRESS", label: "처리 중" },
  { value: "SUCCEEDED", label: "완료" },
  { value: "FAILED", label: "실패" },
] as const;

type ValidStatus = "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED";

function isValidStatus(s: string): s is ValidStatus {
  return ["PENDING", "IN_PROGRESS", "SUCCEEDED", "FAILED"].includes(s);
}

function formatDateTime(d: Date | string): string {
  return new Date(d).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function RefundJobStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE_COLORS[status] ?? "bg-gray-100 text-gray-700"}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function SummaryCard({
  label,
  count,
  color,
  href,
}: {
  label: string;
  count: number;
  color: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition-colors hover:opacity-90 ${color}`}
    >
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold">{count}</p>
    </Link>
  );
}

function RefundJobTable({ jobs }: { jobs: RefundJobRow[] }) {
  if (jobs.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-400">
        해당 조건의 환불 작업이 없습니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              예약 ID
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              고객
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              상품
            </th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">
              금액
            </th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">
              상태
            </th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">
              시도
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              다음 실행
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              오류
            </th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">
              생성
            </th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr
              key={job.id}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/admin/bookings/${job.bookingId}`}
                  className="font-mono text-xs text-indigo-600 hover:underline"
                >
                  {job.bookingId.slice(-8)}
                </Link>
              </td>
              <td className="px-4 py-3">
                <p className="font-medium text-gray-900">
                  {job.booking.user.name ?? "—"}
                </p>
                <p className="text-xs text-gray-500">
                  {job.booking.user.email ?? ""}
                </p>
              </td>
              <td className="max-w-[160px] truncate px-4 py-3 text-gray-700">
                {job.booking.departure.product.title}
              </td>
              <td className="px-4 py-3 text-right text-gray-900">
                {job.amount.toLocaleString("ko-KR")}원
              </td>
              <td className="px-4 py-3 text-center">
                <RefundJobStatusBadge status={job.status} />
              </td>
              <td className="px-4 py-3 text-center text-gray-700">
                {job.attempts}회
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {job.status === "PENDING" && job.nextRunAt
                  ? formatDateTime(job.nextRunAt)
                  : "—"}
              </td>
              <td className="max-w-[200px] px-4 py-3">
                {job.lastError ? (
                  <span
                    className="block truncate font-mono text-xs text-red-600"
                    title={job.lastError}
                  >
                    {job.lastError.slice(0, 60)}
                  </span>
                ) : (
                  <span className="text-xs text-gray-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {formatDateTime(job.createdAt)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type PageProps = {
  searchParams: Promise<{ status?: string }>;
};

export default async function AdminRefundJobsPage({ searchParams }: PageProps) {
  const { status: rawStatus } = await searchParams;
  const statusFilter = rawStatus && isValidStatus(rawStatus) ? rawStatus : undefined;

  const [{ statusCounts }, jobs] = await Promise.all([
    summarizeRefundJobs(),
    listRefundJobs({ status: statusFilter, limit: 100 }),
  ]);

  const count = (s: string) => (statusCounts as Record<string, number>)[s] ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">환불 모니터링</h1>
        <p className="mt-1 text-sm text-gray-500">
          RefundJob 큐 전체 상태 · 지수 백오프 재시도 현황
        </p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="대기"
          count={count("PENDING")}
          color="border-yellow-200 bg-yellow-50 text-yellow-900"
          href="/admin/refund-jobs?status=PENDING"
        />
        <SummaryCard
          label="처리 중"
          count={count("IN_PROGRESS")}
          color="border-blue-200 bg-blue-50 text-blue-900"
          href="/admin/refund-jobs?status=IN_PROGRESS"
        />
        <SummaryCard
          label="완료"
          count={count("SUCCEEDED")}
          color="border-green-200 bg-green-50 text-green-900"
          href="/admin/refund-jobs?status=SUCCEEDED"
        />
        <SummaryCard
          label="실패"
          count={count("FAILED")}
          color="border-red-200 bg-red-50 text-red-900"
          href="/admin/refund-jobs?status=FAILED"
        />
      </div>

      {/* 상태 필터 탭 */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const isActive =
            (opt.value === "" && !statusFilter) ||
            opt.value === statusFilter;
          return (
            <Link
              key={opt.value}
              href={
                opt.value
                  ? `/admin/refund-jobs?status=${opt.value}`
                  : "/admin/refund-jobs"
              }
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-gray-900 text-white"
                  : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* 목록 테이블 */}
      <RefundJobTable jobs={jobs} />
    </div>
  );
}
