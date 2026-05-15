import Link from "next/link";

export default function CheckoutNotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="mb-2 text-4xl font-bold text-gray-900">
          출발일을 찾을 수 없습니다.
        </h1>
        <p className="mb-8 text-lg text-gray-600">
          선택하신 출발일이 존재하지 않거나 이미 마감되었습니다.
        </p>
        <Link
          href="/products"
          className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors duration-200 hover:bg-blue-700"
        >
          ← 상품 목록으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
