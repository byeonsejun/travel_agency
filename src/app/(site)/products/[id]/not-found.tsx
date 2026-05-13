import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">
          상품을 찾을 수 없습니다.
        </h1>
        <p className="text-lg text-gray-600 mb-8">
          요청하신 상품이 존재하지 않거나 삭제되었습니다.
        </p>
        <Link
          href="/products"
          className="inline-block px-6 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors duration-200"
        >
          ← 상품 목록으로 돌아가기
        </Link>
      </div>
    </div>
  );
}
