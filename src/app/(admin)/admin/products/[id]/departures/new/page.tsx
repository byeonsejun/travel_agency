import Link from "next/link";
import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import { DepartureForm, createDepartureAction } from "@/features/admin-departure";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewDeparturePage({ params }: PageProps) {
  const { id: productId } = await params;
  // productId를 신뢰된 route param에서 bind — 사용자 입력 본문에 두지 않음.
  const action = createDepartureAction.bind(null, productId);
  const policies = await getActivePenaltyPolicies();
  const policyOptions = policies.map((p) => ({ key: p.key, name: p.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/products/${productId}/departures`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-foreground">출발일 생성</h1>
      </div>
      <div className="max-w-2xl rounded-xl border border-border bg-card p-6">
        <DepartureForm action={action} policies={policyOptions} />
      </div>
    </div>
  );
}
