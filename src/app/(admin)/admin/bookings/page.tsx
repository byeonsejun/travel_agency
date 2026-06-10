import Link from "next/link";
import {
  listAllBookings,
  BookingStatusBadge,
} from "@/entities/booking";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/shared/ui/table";
import { Button } from "@/shared/ui/button";

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
        <h1 className="text-2xl font-bold text-foreground">예약 관리</h1>
        <span className="text-sm text-muted-foreground">
          최근 50건 / 총 {total.toLocaleString("ko-KR")}건
        </span>
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-12 text-center text-muted-foreground">
          등록된 예약이 없습니다.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>예약 ID</TableHead>
              <TableHead>상품</TableHead>
              <TableHead>출발일</TableHead>
              <TableHead>고객</TableHead>
              <TableHead className="text-right">금액</TableHead>
              <TableHead className="text-center">상태</TableHead>
              <TableHead className="text-center">관리</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((b) => {
              const pax = b.adultCount + b.childCount + b.infantCount;
              return (
                <TableRow key={b.id}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    ...{b.id.slice(-10)}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {b.departure.product.title}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.createdAt.toLocaleDateString("ko-KR")} 예약 · 인원{" "}
                      {pax}명
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-foreground">{formatDate(b.departure.departureDate)}</div>
                    <div className="text-xs text-muted-foreground">
                      ~ {formatDate(b.departure.returnDate)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm text-foreground">
                      {b.user.name ?? b.user.email ?? "(no name)"}
                    </div>
                    {b.user.email && b.user.name && (
                      <div className="text-xs text-muted-foreground">
                        {b.user.email}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-foreground">
                    {b.totalPrice.toLocaleString("ko-KR")}원
                  </TableCell>
                  <TableCell className="text-center">
                    <BookingStatusBadge status={b.status} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/admin/bookings/${b.id}`}>상세</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
