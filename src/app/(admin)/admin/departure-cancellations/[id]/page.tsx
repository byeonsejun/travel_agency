import Link from "next/link";
import { notFound } from "next/navigation";
import { getCancellationBatchDetail } from "@/entities/departure-cancellation";
import { retryBatchRefundAction } from "@/features/admin-departure-cancel";
import type { RefundJobStatus } from "@prisma/client";
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

// 동기화 유지: departure-cancellations/page.tsx (BATCH_TONE)
const JOB_TONE: Record<RefundJobStatus, Tone> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
};

const JOB_LABEL: Record<RefundJobStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
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
        <Link href="/admin/departure-cancellations" className="text-sm text-muted-foreground hover:text-foreground">
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-foreground">취소 배치 상세</h1>
        <Badge variant="neutral">{batch.status}</Badge>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 text-sm">
        <p>
          총 예약 {batch.totalBookings}건 · 즉시 취소(미결제) {batch.immediateCancels}건 · 환불 job{" "}
          {batch.jobs.length}건
        </p>
        {batch.reason && <p className="mt-1 text-muted-foreground">사유: {batch.reason}</p>}
      </div>

      {hasFailed && (
        <form action={retryBatchRefundAction}>
          <input type="hidden" name="batchId" value={batch.id} />
          <Button type="submit" variant="destructive">
            실패 건 전체 재시도
          </Button>
        </form>
      )}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>예약 ID</TableHead>
            <TableHead className="text-center">환불 상태</TableHead>
            <TableHead className="text-center">시도</TableHead>
            <TableHead>오류</TableHead>
            <TableHead className="text-center">재시도</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {batch.jobs.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-xs text-muted-foreground">
                환불 job 없음 (전부 미결제 즉시 취소).
              </TableCell>
            </TableRow>
          ) : (
            batch.jobs.map((j) => (
              <TableRow key={j.id}>
                <TableCell className="font-mono text-xs">{j.bookingId.slice(-8)}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={JOB_TONE[j.status as RefundJobStatus]}>
                    {JOB_LABEL[j.status as RefundJobStatus] ?? j.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">{j.attempts}</TableCell>
                <TableCell className="text-xs text-red-600">
                  {j.lastError ? j.lastError.slice(0, 80) : "—"}
                </TableCell>
                <TableCell className="text-center">
                  {j.status === "FAILED" && (
                    <form action={retryBatchRefundAction}>
                      <input type="hidden" name="batchId" value={batch.id} />
                      <input type="hidden" name="jobId" value={j.id} />
                      <Button type="submit" variant="outline" size="sm">
                        재시도
                      </Button>
                    </form>
                  )}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
