import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import type { PenaltyTier } from "@/entities/penalty-policy";
import { PenaltyPolicyForm } from "@/features/admin-penalty-policy";

// admin 도메인 — 캐시 비활성(§6 안전 도메인). 정책 변경 즉시 반영.
export const dynamic = "force-dynamic";

const CATCH_ALL = -99999;

/** tiers JSON 을 사람이 읽는 요약으로(서버 렌더). 방어적으로 형태만 좁힌다. */
function summarizeTiers(raw: unknown): string {
  if (!Array.isArray(raw)) return "—";
  return (raw as PenaltyTier[])
    .map((t) => {
      const when =
        t.minDaysBefore <= CATCH_ALL
          ? "그 외"
          : `D-${t.minDaysBefore}+`;
      return `${when} ${Math.round(t.rate * 100)}%`;
    })
    .join(" · ");
}

export default async function PenaltyPoliciesPage() {
  const policies = await getActivePenaltyPolicies();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">위약금 정책</h1>
        <p className="mt-1 text-sm text-gray-500">
          상품·출발일에 매핑할 위약금 정책 템플릿. 정책은 append-only 불변 버전으로
          관리되며, 예약은 생성 시점 버전으로 동결됩니다.
        </p>
      </div>

      {/* 활성 정책 목록 */}
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600">key</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">이름</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600">
                활성 버전
              </th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">
                구간 요약
              </th>
            </tr>
          </thead>
          <tbody>
            {policies.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-10 text-center text-sm text-gray-400"
                >
                  등록된 정책이 없습니다. 아래에서 첫 정책을 생성하세요.
                </td>
              </tr>
            ) : (
              policies.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-gray-100 last:border-0 hover:bg-gray-50"
                >
                  <td className="px-4 py-3 font-mono text-xs text-gray-800">
                    {p.key}
                  </td>
                  <td className="px-4 py-3 text-gray-900">{p.name}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                      v{p.version}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {summarizeTiers(p.tiers)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 생성/편집 폼 island */}
      <PenaltyPolicyForm />
    </div>
  );
}
