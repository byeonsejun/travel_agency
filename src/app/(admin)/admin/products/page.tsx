import Link from "next/link";
import {
  listAdminProducts,
  ADMIN_PAGE_SIZE,
} from "@/entities/product";
import type { AdminProductRow } from "@/entities/product";
import type { ProductStatus, EmbeddingJobStatus } from "@prisma/client";
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

// ── 상수 ────────────────────────────────────────────────────────────
const VALID_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;

const STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "임시저장",
  PUBLISHED: "게시",
  CLOSED: "보관",
};

const STATUS_TONE: Record<ProductStatus, "success" | "warning" | "neutral"> = {
  DRAFT: "warning",
  PUBLISHED: "success",
  CLOSED: "neutral",
};

// 동기화 유지: products/[id]/edit/page.tsx 의 JOB_STATUS_TONE 과 동일 매핑.
const JOB_TONE: Record<
  EmbeddingJobStatus,
  "warning" | "info" | "success" | "destructive"
> = {
  PENDING: "warning",
  IN_PROGRESS: "info",
  SUCCEEDED: "success",
  FAILED: "destructive",
};

const JOB_LABELS: Record<EmbeddingJobStatus, string> = {
  PENDING: "대기",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

const FILTER_OPTIONS: { value: ProductStatus | ""; label: string }[] = [
  { value: "", label: "전체" },
  { value: "DRAFT", label: "임시저장" },
  { value: "PUBLISHED", label: "게시" },
  { value: "CLOSED", label: "보관" },
];

// ── 헬퍼 ───────────────────────────────────────────────────────────
function isValidStatus(s: string): s is ProductStatus {
  return (VALID_STATUSES as readonly string[]).includes(s);
}

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleDateString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  });
}

// ── Sub-components ─────────────────────────────────────────────────
function StatusBadge({ status }: { status: ProductStatus }) {
  return <Badge variant={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>;
}

function EmbeddingJobBadge({
  job,
}: {
  job: AdminProductRow["latestJob"];
}) {
  if (!job) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <Badge variant={JOB_TONE[job.status]} title={job.lastError ?? undefined}>
      {JOB_LABELS[job.status]}
      {job.attempts > 0 && ` (${job.attempts}회)`}
    </Badge>
  );
}

function ProductTable({ items }: { items: AdminProductRow[] }) {
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-muted-foreground">
        해당 조건의 상품이 없습니다.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>상품명</TableHead>
          <TableHead>목적지</TableHead>
          <TableHead className="text-center">상태</TableHead>
          <TableHead className="text-right">기본가</TableHead>
          <TableHead className="text-center">임베딩</TableHead>
          <TableHead>수정일</TableHead>
          <TableHead className="text-center">관리</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="max-w-[240px]">
              <span className="block truncate font-medium text-foreground">
                {row.title}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {row.id.slice(-8)}
              </span>
            </TableCell>
            <TableCell className="text-muted-foreground">{row.destination}</TableCell>
            <TableCell className="text-center">
              <StatusBadge status={row.status} />
            </TableCell>
            <TableCell className="text-right text-foreground">
              {row.basePriceAdult.toLocaleString("ko-KR")}원
            </TableCell>
            <TableCell className="text-center">
              <EmbeddingJobBadge job={row.latestJob} />
            </TableCell>
            <TableCell className="text-xs text-muted-foreground">
              {formatDateTime(row.updatedAt)}
            </TableCell>
            <TableCell className="text-center">
              <Button asChild variant="secondary" size="sm">
                <Link href={`/admin/products/${row.id}/edit`}>편집</Link>
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

// ── Page ───────────────────────────────────────────────────────────
type PageProps = {
  searchParams: Promise<{ status?: string; page?: string }>;
};

export default async function AdminProductsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const statusFilter =
    params.status && isValidStatus(params.status) ? params.status : undefined;
  const page = Math.max(parseInt(params.page ?? "1", 10) || 1, 1);

  const { items, total } = await listAdminProducts({
    status: statusFilter,
    page,
  });

  const totalPages = Math.ceil(total / ADMIN_PAGE_SIZE);

  const buildHref = (overrides: { status?: string; page?: number }) => {
    const sp = new URLSearchParams();
    const s = overrides.status ?? (statusFilter ?? "");
    const p = overrides.page ?? page;
    if (s) sp.set("status", s);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return `/admin/products${qs ? `?${qs}` : ""}`;
  };

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">상품 관리</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            총 {total.toLocaleString("ko-KR")}개
            {statusFilter && ` · ${STATUS_LABELS[statusFilter]} 필터`}
          </p>
        </div>
        <Button asChild>
          <Link href="/admin/products/new">+ 상품 등록</Link>
        </Button>
      </div>

      {/* 상태 필터 탭 */}
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.map((opt) => {
          const isActive =
            (opt.value === "" && !statusFilter) || opt.value === statusFilter;
          return (
            <Link
              key={opt.value || "__all"}
              href={buildHref({ status: opt.value, page: 1 })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-card text-muted-foreground hover:bg-muted"
              }`}
            >
              {opt.label}
            </Link>
          );
        })}
      </div>

      {/* 목록 테이블 */}
      <ProductTable items={items} />

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Link
            href={buildHref({ page: page - 1 })}
            aria-disabled={page <= 1}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              page <= 1
                ? "pointer-events-none text-muted-foreground opacity-50"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            이전
          </Link>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Link
            href={buildHref({ page: page + 1 })}
            aria-disabled={page >= totalPages}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              page >= totalPages
                ? "pointer-events-none text-muted-foreground opacity-50"
                : "border border-border bg-card text-muted-foreground hover:bg-muted"
            }`}
          >
            다음
          </Link>
        </div>
      )}
    </div>
  );
}
