import Link from "next/link";

import {
  summarizeEmbeddingJobs,
  listEmbeddingJobs,
} from "@/entities/product";
import type { EmbeddingJobRow } from "@/entities/product";
import { retryEmbeddingJobAction } from "@/features/admin-product/server/actions";
import type { EmbeddingJobStatus } from "@prisma/client";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";

export const dynamic = "force-dynamic";

type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

const JOB_TONE: Record<EmbeddingJobStatus, Tone> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
};

const STATUS_LABELS: Record<EmbeddingJobStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

const FILTER_OPTIONS = [
  { value: "", label: "전체" },
  { value: "PENDING", label: "대기" },
  { value: "IN_PROGRESS", label: "처리 중" },
  { value: "SUCCEEDED", label: "완료" },
  { value: "FAILED", label: "실패" },
] as const;

type ValidStatus = EmbeddingJobStatus;

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

function StatusBadge({ status }: { status: EmbeddingJobStatus }) {
  return (
    <Badge variant={JOB_TONE[status]}>
      {STATUS_LABELS[status]}
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

function EmbeddingJobTable({ jobs }: { jobs: EmbeddingJobRow[] }) {
  if (jobs.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        해당 조건의 임베딩 작업이 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상품</TableHead>
          <TableHead className="text-center">상태</TableHead>
          <TableHead className="text-center">시도</TableHead>
          <TableHead>다음 실행</TableHead>
          <TableHead>오류</TableHead>
          <TableHead>갱신</TableHead>
          <TableHead className="text-center">액션</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {jobs.map((job) => (
          <TableRow key={job.id}>
            <TableCell className="max-w-[200px]">
              <Link
                href={`/admin/products/${job.productId}/edit`}
                className="block truncate font-medium text-primary hover:underline"
              >
                {job.product.title}
              </Link>
              <p className="font-mono text-xs text-muted-foreground">
                {job.productId.slice(-8)}
              </p>
            </TableCell>
            <TableCell className="text-center">
              <StatusBadge status={job.status as EmbeddingJobStatus} />
            </TableCell>
            <TableCell className="text-center text-foreground">
              {job.attempts}회
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {job.status === "PENDING" || job.status === "FAILED"
                ? formatDateTime(job.nextRunAt)
                : "—"}
            </TableCell>
            <TableCell className="max-w-[240px]">
              {job.lastError ? (
                <span
                  className="block truncate font-mono text-xs text-red-600"
                  title={job.lastError}
                >
                  {job.lastError.slice(0, 60)}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">—</span>
              )}
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(job.updatedAt)}
            </TableCell>
            <TableCell className="text-center">
              {job.status === "FAILED" && (
                <form action={retryEmbeddingJobAction}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <Button type="submit" variant="outline" size="sm">
                    재시도
                  </Button>
                </form>
              )}
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

export default async function AdminEmbeddingJobsPage({
  searchParams,
}: PageProps) {
  const { status: rawStatus } = await searchParams;
  const statusFilter =
    rawStatus && isValidStatus(rawStatus) ? rawStatus : undefined;

  const [{ statusCounts }, jobs] = await Promise.all([
    summarizeEmbeddingJobs(),
    listEmbeddingJobs({ status: statusFilter, limit: 100 }),
  ]);

  const count = (s: string) =>
    (statusCounts as Record<string, number>)[s] ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">임베딩 Job 모니터링</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          EmbeddingJob 큐 전체 상태 · contentHash 멱등 · 지수 백오프 재시도 현황
        </p>
      </div>

      {/* 요약 카드 — semantic status colors 보존 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="대기"
          count={count("PENDING")}
          color="border-yellow-200 bg-yellow-50 text-yellow-900"
          href="/admin/embedding-jobs?status=PENDING"
        />
        <SummaryCard
          label="처리 중"
          count={count("IN_PROGRESS")}
          color="border-blue-200 bg-blue-50 text-blue-900"
          href="/admin/embedding-jobs?status=IN_PROGRESS"
        />
        <SummaryCard
          label="완료"
          count={count("SUCCEEDED")}
          color="border-green-200 bg-green-50 text-green-900"
          href="/admin/embedding-jobs?status=SUCCEEDED"
        />
        <SummaryCard
          label="실패"
          count={count("FAILED")}
          color="border-red-200 bg-red-50 text-red-900"
          href="/admin/embedding-jobs?status=FAILED"
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
                  ? `/admin/embedding-jobs?status=${opt.value}`
                  : "/admin/embedding-jobs"
              }
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* 목록 테이블 */}
      <EmbeddingJobTable jobs={jobs} />
    </div>
  );
}
