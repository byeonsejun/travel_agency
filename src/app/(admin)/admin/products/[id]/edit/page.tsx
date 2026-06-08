import Link from "next/link";
import { notFound } from "next/navigation";
import { getAdminProductById } from "@/entities/product";
import type { AdminEmbeddingInfo, AdminLatestJobInfo } from "@/entities/product";
import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import { ProductForm } from "@/features/admin-product";
import type { EmbeddingJobStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// ── 임베딩 상태 사이드바 ───────────────────────────────────────────

const JOB_STATUS_BADGE: Record<EmbeddingJobStatus, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  SUCCEEDED: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
};

const JOB_STATUS_LABELS: Record<EmbeddingJobStatus, string> = {
  PENDING: "대기 중",
  IN_PROGRESS: "처리 중",
  SUCCEEDED: "완료",
  FAILED: "실패",
};

function formatDateTime(d: Date): string {
  return new Date(d).toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EmbeddingSidebar({
  embedding,
  latestJob,
}: {
  embedding: AdminEmbeddingInfo | null;
  latestJob: AdminLatestJobInfo | null;
}) {
  return (
    <aside className="space-y-4">
      {/* 임베딩 인덱스 현황 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">임베딩 인덱스</h2>
        {embedding ? (
          <dl className="space-y-2 text-sm">
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-gray-500">모델</dt>
              <dd className="font-mono text-xs text-right text-gray-700 break-all">
                {embedding.modelVersion}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-gray-500">콘텐츠 해시</dt>
              <dd className="font-mono text-xs text-right text-gray-400 break-all">
                {embedding.contentHash
                  ? embedding.contentHash.slice(0, 12) + "…"
                  : "—"}
              </dd>
            </div>
            <div className="flex items-start justify-between gap-2">
              <dt className="shrink-0 text-gray-500">색인 시각</dt>
              <dd className="text-xs text-gray-700">
                {formatDateTime(embedding.updatedAt)}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-xs text-gray-400">아직 색인되지 않았습니다.</p>
        )}
      </div>

      {/* 최근 Job 현황 */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-900">최근 임베딩 작업</h2>
        {latestJob ? (
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-500">상태</dt>
              <dd>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${JOB_STATUS_BADGE[latestJob.status]}`}
                >
                  {JOB_STATUS_LABELS[latestJob.status]}
                </span>
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-500">시도 횟수</dt>
              <dd className="text-gray-700">{latestJob.attempts}회</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-gray-500">갱신 시각</dt>
              <dd className="text-xs text-gray-700">
                {formatDateTime(latestJob.updatedAt)}
              </dd>
            </div>
            {latestJob.status === "PENDING" && (
              <div className="flex items-center justify-between gap-2">
                <dt className="text-gray-500">예정 실행</dt>
                <dd className="text-xs text-gray-700">
                  {formatDateTime(latestJob.nextRunAt)}
                </dd>
              </div>
            )}
            {latestJob.lastError && (
              <div className="space-y-1">
                <dt className="text-gray-500">오류</dt>
                <dd className="rounded-lg bg-red-50 p-2 font-mono text-xs text-red-600 break-all">
                  {latestJob.lastError.slice(0, 300)}
                </dd>
              </div>
            )}
            {latestJob.contentHash && (
              <div className="flex items-start justify-between gap-2">
                <dt className="shrink-0 text-gray-500">처리 해시</dt>
                <dd className="font-mono text-xs text-right text-gray-400 break-all">
                  {latestJob.contentHash.slice(0, 12)}…
                </dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-xs text-gray-400">작업 이력이 없습니다.</p>
        )}

        <div className="pt-2 border-t border-gray-100">
          <Link
            href="/admin/embedding-jobs"
            className="text-xs text-indigo-600 hover:underline"
          >
            전체 임베딩 Job 모니터링 →
          </Link>
        </div>
      </div>
    </aside>
  );
}

// ── Page ───────────────────────────────────────────────────────────
type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function AdminProductEditPage({ params }: PageProps) {
  const { id } = await params;
  const [result, policies] = await Promise.all([
    getAdminProductById(id),
    getActivePenaltyPolicies(),
  ]);

  if (!result) notFound();

  const { product, embedding, latestJob } = result;
  const policyOptions = policies.map((p) => ({ key: p.key, name: p.name }));

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/products"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 목록
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">상품 편집</h1>
          <p className="mt-0.5 font-mono text-xs text-gray-400">{product.id}</p>
        </div>
        <Link
          href={`/admin/products/${product.id}/departures`}
          className="ml-auto rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800"
        >
          출발일 관리 →
        </Link>
      </div>

      {/* 2-column 레이아웃 */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_280px]">
        {/* 좌: 편집 폼 */}
        <div>
          <ProductForm mode="edit" initial={product} policies={policyOptions} />
        </div>

        {/* 우: 임베딩 상태 사이드바 */}
        <EmbeddingSidebar embedding={embedding} latestJob={latestJob} />
      </div>
    </div>
  );
}
