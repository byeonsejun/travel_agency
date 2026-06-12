import Link from "next/link";
import type { ReviewStatus } from "@prisma/client";
import {
  listReviewsForAdmin,
  listReviewsWithOpenReports,
} from "@/entities/review";
import { REPORT_REASON_LABELS } from "@/features/review-feed";
import { Button } from "@/shared/ui/button";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table";


const STATUS_LABELS: Record<ReviewStatus, string> = {
  PUBLISHED: "공개",
  HIDDEN: "숨김",
  REPORTED: "신고됨",
};

type Tone = "success" | "warning" | "info" | "destructive" | "neutral";
const REVIEW_TONE: Record<ReviewStatus, Tone> = {
  PUBLISHED: "success",
  HIDDEN: "neutral",
  REPORTED: "warning",
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
  const isReportedView = filter === "REPORTED";

  const reportedPage = isReportedView
    ? await listReviewsWithOpenReports({ limit: 30 })
    : null;
  const page = isReportedView
    ? null
    : await listReviewsForAdmin({ status: filter, limit: 30 });

  return (
    <div>
      <h1 className="mb-4 text-xl font-bold text-foreground">리뷰 관리</h1>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => {
          const active = (status ?? "") === f.value;
          return (
            <Button
              key={f.value}
              asChild
              variant={active ? "default" : "outline"}
              size="sm"
            >
              <Link
                href={
                  f.value ? `/admin/reviews?status=${f.value}` : "/admin/reviews"
                }
              >
                {f.label}
              </Link>
            </Button>
          );
        })}
      </div>

      {isReportedView ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>작성자</TableHead>
              <TableHead>별점</TableHead>
              <TableHead>신고</TableHead>
              <TableHead>대표 사유</TableHead>
              <TableHead>작성일</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reportedPage!.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  처리 대기 중인 신고가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              reportedPage!.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-xs truncate">
                    <Link
                      href={`/admin/reviews/${r.id}`}
                      className="text-primary hover:underline"
                    >
                      {r.productTitle}
                    </Link>
                  </TableCell>
                  <TableCell>{r.authorDisplayName}</TableCell>
                  <TableCell>{r.rating}점</TableCell>
                  <TableCell>
                    <Badge variant="warning">{r.openReportCount}건</Badge>
                  </TableCell>
                  <TableCell>
                    {r.topReason ? REPORT_REASON_LABELS[r.topReason] : "-"}
                  </TableCell>
                  <TableCell>{formatDate(r.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품</TableHead>
              <TableHead>작성자</TableHead>
              <TableHead>별점</TableHead>
              <TableHead>사진</TableHead>
              <TableHead>상태</TableHead>
              <TableHead>작성일</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {page!.items.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={7}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  표시할 리뷰가 없습니다.
                </TableCell>
              </TableRow>
            ) : (
              page!.items.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-xs truncate">
                    {r.productTitle}
                  </TableCell>
                  <TableCell>{r.authorDisplayName}</TableCell>
                  <TableCell>{r.rating}점</TableCell>
                  <TableCell>{r.photoCount}</TableCell>
                  <TableCell>
                    <Badge variant={REVIEW_TONE[r.status]}>
                      {STATUS_LABELS[r.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(r.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/admin/reviews/${r.id}`}>상세</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
