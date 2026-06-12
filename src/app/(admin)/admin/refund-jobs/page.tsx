import Link from "next/link";
import { summarizeRefundJobs, listRefundJobs } from "@/entities/payment";
import type { RefundJobRow } from "@/entities/payment";
import type { RefundJobStatus } from "@prisma/client";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/shared/ui/table";


const STATUS_LABELS: Record<string, string> = {
  PENDING: "대기",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

// 동기화 유지: src/app/(admin)/admin/bookings/[id]/page.tsx (PaymentStatusBadge는 entities에서 소비)
type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

const REFUND_TONE: Record<RefundJobStatus, Tone> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
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

function RefundJobStatusBadge({ status }: { status: RefundJobStatus }) {
  return (
    <Badge variant={REFUND_TONE[status] ?? "neutral"}>
      {STATUS_LABELS[status] ?? status}
    </Badge>
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
      <p className="py-12 text-center text-sm text-muted-foreground">
        해당 조건의 환불 작업이 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>예약 ID</TableHead>
          <TableHead>고객</TableHead>
          <TableHead>상품</TableHead>
          <TableHead className="text-right">금액</TableHead>
          <TableHead className="text-center">상태</TableHead>
          <TableHead className="text-center">시도</TableHead>
          <TableHead>다음 실행</TableHead>
          <TableHead>오류</TableHead>
          <TableHead>생성</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell>
              <Link
                href={`/admin/bookings/${job.bookingId}`}
                className="font-mono text-xs text-primary hover:underline"
              >
                {job.bookingId.slice(-8)}
              </Link>
            </TableCell>
            <TableCell>
              <p className="font-medium text-foreground">
                {job.booking.user.name ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">
                {job.booking.user.email ?? ""}
              </p>
            </TableCell>
            <TableCell className="max-w-[160px] truncate text-foreground">
              {job.booking.departure.product.title}
            </TableCell>
            <TableCell className="text-right text-foreground">
              {job.amount.toLocaleString("ko-KR")}원
            </TableCell>
            <TableCell className="text-center">
              <RefundJobStatusBadge status={job.status} />
            </TableCell>
            <TableCell className="text-center text-foreground">
              {job.attempts}회
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {job.status === "PENDING" && job.nextRunAt
                ? formatDateTime(job.nextRunAt)
                : "—"}
            </TableCell>
            <TableCell className="max-w-[200px]">
              {job.lastError ? (
                <span
                  className="block truncate font-mono text-xs text-destructive"
                  title={job.lastError}
                >
                  {job.lastError.slice(0, 60)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(job.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
        <h1 className="text-2xl font-bold text-foreground">환불 모니터링</h1>
        <p className="mt-1 text-sm text-muted-foreground">
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
            <Button
              key={opt.value}
              asChild
              variant={isActive ? "default" : "outline"}
              size="sm"
            >
              <Link
                href={
                  opt.value
                    ? `/admin/refund-jobs?status=${opt.value}`
                    : "/admin/refund-jobs"
                }
              >
                {opt.label}
              </Link>
            </Button>
          );
        })}
      </div>

      {/* 목록 테이블 */}
      <RefundJobTable jobs={jobs} />
    </div>
  );
}
