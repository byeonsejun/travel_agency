import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import type { PenaltyTier } from "@/entities/penalty-policy";
import { PenaltyPolicyForm } from "@/features/admin-penalty-policy";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/shared/ui/table";
import { Badge } from "@/shared/ui/badge";

// admin 도메인 — 캐시 비활성(§6 안전 도메인). 정책 변경 즉시 반영.

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
        <h1 className="text-2xl font-bold text-foreground">위약금 정책</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          상품·출발일에 매핑할 위약금 정책 템플릿. 정책은 append-only 불변 버전으로
          관리되며, 예약은 생성 시점 버전으로 동결됩니다.
        </p>
      </div>

      {/* 활성 정책 목록 */}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>key</TableHead>
            <TableHead>이름</TableHead>
            <TableHead className="text-center">활성 버전</TableHead>
            <TableHead>구간 요약</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={4}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                등록된 정책이 없습니다. 아래에서 첫 정책을 생성하세요.
              </TableCell>
            </TableRow>
          ) : (
            policies.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs text-foreground">
                  {p.key}
                </TableCell>
                <TableCell className="text-foreground">{p.name}</TableCell>
                <TableCell className="text-center">
                  <Badge variant="secondary">v{p.version}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {summarizeTiers(p.tiers)}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* 생성/편집 폼 island */}
      <PenaltyPolicyForm />
    </div>
  );
}
