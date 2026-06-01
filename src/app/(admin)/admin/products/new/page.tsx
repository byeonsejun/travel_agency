import Link from "next/link";
import { ProductForm } from "@/features/admin-product";

export const dynamic = "force-dynamic";

export default function AdminProductNewPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/products"
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">상품 등록</h1>
      </div>

      <ProductForm mode="create" />
    </div>
  );
}
