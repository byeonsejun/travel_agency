import { redirect } from "next/navigation";

// /admin 인덱스는 독립 화면이 아니라 관리자 진입점일 뿐이다.
// ADMIN 가드(middleware 1차 + layout 2차)는 이미 적용되므로, 여기서는
// 대시보드(관리자 홈)로 즉시 라우팅만 한다. (직접 접근 시 404 방지)
export default function AdminIndexPage() {
  redirect("/admin/dashboard");
}
