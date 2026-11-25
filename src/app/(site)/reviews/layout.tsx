import { NOINDEX_METADATA } from "@/shared/lib/seo";

// 검색 노출 차단은 이 layout 의 메타데이터로만 건다. 결제 · 예약 페이지 파일은 건드리지 않으려고.
export const metadata = NOINDEX_METADATA;

export default function ReviewsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
