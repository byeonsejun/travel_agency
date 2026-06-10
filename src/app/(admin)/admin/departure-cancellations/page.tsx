import Link from "next/link";
import { listCancellationBatches } from "@/entities/departure-cancellation";
import type { DepartureCancellationStatus } from "@/entities/departure-cancellation";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";

export const dynamic = "force-dynamic";

type Tone = "success" | "warning" | "info" | "destructive" | "neutral";

// 동기화 유지: departure-cancellations/[id]/page.tsx
const BATCH_TONE: Record<DepartureCancellationStatus, Tone> = {
  PROCESSING: "info",
  COMPLETED: "success",
  PARTIALLY_FAILED: "destructive",
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
      <h1 className="text-2xl font-bold text-foreground">출발 취소 배치</h1>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">취소 배치가 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>출발일</TableHead>
              <TableHead className="text-center">상태</TableHead>
              <TableHead className="text-center">진척</TableHead>
              <TableHead className="text-center">실패</TableHead>
              <TableHead>생성</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    href={`/admin/departure-cancellations/${r.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {r.departureLabel}
                  </Link>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={BATCH_TONE[r.status]}>
                    {LABEL[r.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  {r.immediateCancels + r.succeeded} / {r.totalBookings}
                </TableCell>
                <TableCell className="text-center">
                  {r.failed > 0 ? (
                    <span className="font-semibold text-red-600">{r.failed}</span>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString("ko-KR")}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
