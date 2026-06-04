import Link from "next/link";
import { DepartureForm, createDepartureAction } from "@/features/admin-departure";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewDeparturePage({ params }: PageProps) {
  const { id: productId } = await params;
  // productId를 신뢰된 route param에서 bind — 사용자 입력 본문에 두지 않음.
  const action = createDepartureAction.bind(null, productId);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/products/${productId}/departures`}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          ← 목록
        </Link>
        <h1 className="text-2xl font-bold text-gray-900">출발일 생성</h1>
      </div>
      <div className="max-w-2xl rounded-xl border border-gray-200 bg-white p-6">
        <DepartureForm action={action} />
      </div>
    </div>
  );
}
