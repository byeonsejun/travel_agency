import Link from "next/link";
import { listAdminDepartures, DEPARTURE_STATUS_LABEL } from "@/entities/departure";
import type { DepartureStatus } from "@prisma/client";
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

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

// 동기화 유지: departures/[depId]/edit/page.tsx 의 DEPARTURE_STATUS_TONE 과 동일 매핑.
const STATUS_TONE: Record<DepartureStatus, "info" | "success" | "neutral" | "destructive"> = {
  SCHEDULED: "info",
  CONFIRMED: "success",
  CLOSED: "neutral",
  CANCELED: "destructive",
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
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← 상품
          </Link>
          <h1 className="text-2xl font-bold text-foreground">출발일 관리</h1>
        </div>
        <Button asChild>
          <Link href={`/admin/products/${productId}/departures/new`}>
            + 출발일 생성
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">출발일이 없습니다.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>출발 / 귀국</TableHead>
              <TableHead className="text-right">성인 / 아동</TableHead>
              <TableHead className="text-center">좌석</TableHead>
              <TableHead className="text-center">minPax</TableHead>
              <TableHead className="text-center">상태</TableHead>
              <TableHead className="text-center">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((d) => (
              <TableRow key={d.id}>
                <TableCell>
                  {fmt(d.departureDate)} ~ {fmt(d.returnDate)}
                </TableCell>
                <TableCell className="text-right">
                  {d.priceAdult.toLocaleString("ko-KR")} /{" "}
                  {d.priceChild.toLocaleString("ko-KR")}원
                </TableCell>
                <TableCell className="text-center">
                  {d.bookedSeats}/{d.capacity}
                  {d.bookedSeats >= d.minPax && (
                    <span className="ml-1 rounded bg-green-50 px-1.5 text-xs text-green-700">
                      확정가능
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-center text-muted-foreground">{d.minPax}</TableCell>
                <TableCell className="text-center">
                  <Badge variant={STATUS_TONE[d.status]}>
                    {DEPARTURE_STATUS_LABEL[d.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Button asChild variant="secondary" size="sm">
                    <Link href={`/admin/products/${productId}/departures/${d.id}/edit`}>
                      편집
                    </Link>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
