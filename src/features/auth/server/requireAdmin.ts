import { redirect } from "next/navigation";
import { auth } from "./auth";

/**
 * admin page 가 데이터를 읽기 전에 직접 호출하는 ADMIN 가드.
 *
 * middleware 와 admin layout 의 가드만으로는 부족했다.
 * - middleware 는 matcher 의 prefetch 헤더 예외(`purpose: prefetch`)로 건너뛸 수 있었다.
 * - layout 의 가드는 <Suspense> 안에서 돌고, App Router 는 page segment 를 layout 과
 *   따로 렌더링하므로 layout 의 redirect 가 page 의 데이터 조회를 막지 못한다.
 * 그래서 page 마다 첫 줄에서 이 함수를 부른다. 반환값은 확인된 session.
 */
export async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/admin/bookings");
  }
  if (session.user.role !== "ADMIN") {
    redirect("/");
  }
  return session;
}
