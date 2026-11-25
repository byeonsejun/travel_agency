import { SITE_NAME, absoluteUrl } from "./site";

// 도메인을 모르는 순수 함수 — 상품 목록은 호출하는 쪽이 { path, label } 로 바꿔 넘긴다.
export function buildLlmsTxt(input: {
  products: { path: string; label: string }[];
}): string {
  const blocks: string[] = [
    `# ${SITE_NAME}`,
    "> AI 로 조건에 맞는 패키지 여행을 찾고 출발일을 골라 예약하는 여행사 데모입니다. 포트폴리오용으로 만든 사이트라 결제는 토스페이먼츠 테스트 키와 모의 서버로만 동작하고, 실제 결제는 일어나지 않습니다.",
    [
      "## 주요 페이지",
      `- [여행 상품](${absoluteUrl("/products")})`,
      `- [여행 검색](${absoluteUrl("/search")})`,
      `- [사이트맵](${absoluteUrl("/sitemap.xml")})`,
    ].join("\n"),
  ];

  if (input.products.length > 0) {
    blocks.push(
      [
        "## 상품",
        ...input.products.map((p) => `- [${p.label}](${absoluteUrl(p.path)})`),
      ].join("\n")
    );
  }

  blocks.push(
    [
      "## 만든 사람",
      "- 변세준 — https://sejunb.com",
      "- 저장소 — https://github.com/byeonsejun/travel_agency",
    ].join("\n"),
    [
      "## 기술",
      "- Next.js 16 App Router, TypeScript, Prisma + PostgreSQL, Tailwind CSS, Vitest, Playwright",
    ].join("\n")
  );

  return `${blocks.join("\n\n")}\n`;
}
