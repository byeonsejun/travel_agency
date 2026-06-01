import Link from "next/link";
import {
  listAdminProducts,
  ADMIN_PAGE_SIZE,
} from "@/entities/product";
import type { AdminProductRow } from "@/entities/product";
import type { ProductStatus, EmbeddingJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── 상수 ────────────────────────────────────────────────────────────
const VALID_STATUSES = ["DRAFT", "PUBLISHED", "CLOSED"] as const;

const STATUS_LABELS: Record<ProductStatus, string> = {
  DRAFT: "임시저장",
  PUBLISHED: "게시",
  CLOSED: "보관",
};

const STATUS_BADGE: Record<ProductStatus, string> = {
  DRAFT: "bg-yellow-100 text-yellow-800",
  PUBLISHED: "bg-green-100 text-green-800",
  CLOSED: "bg-gray-100 text-gray-700",
};

const JOB_BADGE: Record<EmbeddingJobStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
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
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_BADGE[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function EmbeddingJobBadge({
  job,
}: {
  job: AdminProductRow["latestJob"];
}) {
  if (!job) {
    return <span className="text-xs text-gray-300">—</span>;
  }
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_BADGE[job.status]}`}
      title={job.lastError ?? undefined}
    >
      {JOB_LABELS[job.status]}
      {job.attempts > 0 && ` (${job.attempts}회)`}
    </span>
  );
}

function ProductTable({ items }: { items: AdminProductRow[] }) {
  if (items.length === 0) {
    return (
      <p className="py-12 text-center text-sm text-gray-400">
        해당 조건의 상품이 없습니다.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">상품명</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">목적지</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">상태</th>
            <th className="px-4 py-3 text-right font-medium text-gray-600">기본가</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">임베딩</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">수정일</th>
            <th className="px-4 py-3 text-center font-medium text-gray-600">관리</th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr
              key={row.id}
              className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
            >
              <td className="max-w-[240px] px-4 py-3">
                <span className="block truncate font-medium text-gray-900">
                  {row.title}
                </span>
                <span className="font-mono text-xs text-gray-400">
                  {row.id.slice(-8)}
                </span>
              </td>
              <td className="px-4 py-3 text-gray-600">{row.destination}</td>
              <td className="px-4 py-3 text-center">
                <StatusBadge status={row.status} />
              </td>
              <td className="px-4 py-3 text-right text-gray-900">
                {row.basePriceAdult.toLocaleString("ko-KR")}원
              </td>
              <td className="px-4 py-3 text-center">
                <EmbeddingJobBadge job={row.latestJob} />
              </td>
              <td className="px-4 py-3 text-xs text-gray-500">
                {formatDateTime(row.updatedAt)}
              </td>
              <td className="px-4 py-3 text-center">
                <Link
                  href={`/admin/products/${row.id}/edit`}
                  className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                >
                  편집
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
          <h1 className="text-2xl font-bold text-gray-900">상품 관리</h1>
          <p className="mt-1 text-sm text-gray-500">
            총 {total.toLocaleString("ko-KR")}개
            {statusFilter && ` · ${STATUS_LABELS[statusFilter]} 필터`}
          </p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700"
        >
          + 상품 등록
        </Link>
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
      <ProductTable items={items} />

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Link
            href={buildHref({ page: page - 1 })}
            aria-disabled={page <= 1}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              page <= 1
                ? "pointer-events-none text-gray-300"
                : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
            }`}
          >
            이전
          </Link>
          <span className="text-sm text-gray-600">
            {page} / {totalPages}
          </span>
          <Link
            href={buildHref({ page: page + 1 })}
            aria-disabled={page >= totalPages}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              page >= totalPages
                ? "pointer-events-none text-gray-300"
                : "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
            }`}
          >
            다음
          </Link>
        </div>
      )}
    </div>
  );
}
