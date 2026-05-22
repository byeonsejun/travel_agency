// 리뷰 작성자 표시 이름 마스킹.
//
// **호출 위치 강제 — server-side only**: 이 함수는 raw email/name 을 입력으로
// 받아 마스킹된 문자열만 반환한다. 클라이언트로 raw email 이 새지 않으려면,
// 본 함수의 호출은 반드시 query 레이어(또는 RSC)에서 이루어져야 하며 결과
// 문자열만 prop/payload 로 전달돼야 한다. `ReviewListItem` 타입이 raw email
// 필드를 포함하지 않는 것이 그 invariant 의 type-level 박제.
//
// 우선순위:
//   1) email 이 truthy → 로컬파트(`@` 앞) 앞 3자 + "***" (3자 미만이면 있는
//      만큼 + "***")
//   2) email 없음 + name truthy → 첫 글자 + "**"
//   3) 둘 다 없음 → "익명"

export function maskAuthorDisplayName(input: {
  email: string | null;
  name: string | null;
}): string {
  if (input.email) {
    const local = input.email.split("@")[0] ?? "";
    return `${local.slice(0, 3)}***`;
  }
  if (input.name && input.name.length > 0) {
    return `${input.name.charAt(0)}**`;
  }
  return "익명";
}
