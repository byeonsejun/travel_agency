import Link from "next/link";
import { getActivePenaltyPolicies } from "@/entities/penalty-policy";
import { ProductForm } from "@/features/admin-product";


export default async function AdminProductNewPage() {
  const policies = await getActivePenaltyPolicies();
  const policyOptions = policies.map((p) => ({ key: p.key, name: p.name }));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/products"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-foreground">상품 등록</h1>
      </div>

      <ProductForm mode="create" policies={policyOptions} />
    </div>
  );
}
