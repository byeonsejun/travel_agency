/**
 * geo.ts — 지리 계층 사전(gazetteer) + 쿼리 확장 (M-AI-SEARCH).
 *
 * 사용자 의도의 비대칭(국가-우선 vs 권역-우선)을 사전으로 흡수한다:
 *  - 일본: 사람들은 "일본"을 먼저 고르고 도쿄/오사카로 좁힌다 → 일본은
 *    국가가 곧 권역 앵커. "일본" → 일본 도시 전체.
 *  - 동남아: "동남아"를 먼저 고르고 방콕/발리로 좁힌다(국가 단계 생략)
 *    → "동남아" → 소속 국가·도시 전체.
 *
 * destination 자유 텍스트("다낭, 베트남")에 "동남아" 글자는 없으므로,
 * 쿼리의 지리어를 destination에 실제로 박혀 있을 법한 하위 토큰들로
 * 펼쳐(expand) 하이브리드 ILIKE ANY 매칭에 넘긴다. DB 마이그레이션 없이
 * 코드 사전만으로 권역 검색 정밀도를 끌어올리는 방식(spec 방안 A).
 *
 * 도메인 지식(상품 목적지)이므로 product 엔티티가 소유한다(FSD: features
 * 라우터는 barrel로만 사용).
 */

interface GeoRegion {
  /** 쿼리에서 이 권역을 가리키는 표현들(부분일치). */
  readonly aliases: readonly string[];
  /** 국가 → 그 국가의 대표 도시들. */
  readonly countries: Readonly<Record<string, readonly string[]>>;
}

export const GEO_TAXONOMY: Readonly<Record<string, GeoRegion>> = {
  일본: {
    aliases: ["일본", "재팬", "japan"],
    countries: {
      일본: ["도쿄", "오사카", "교토", "하코네", "후쿠오카", "삿포로", "오키나와", "나고야"],
    },
  },
  동남아: {
    aliases: ["동남아", "동남아시아", "동남 아시아", "southeast asia"],
    countries: {
      태국: ["방콕", "푸켓", "치앙마이", "파타야"],
      베트남: ["다낭", "하노이", "호치민", "나트랑", "호이안", "푸꾸옥"],
      인도네시아: ["발리", "자카르타", "롬복"],
      필리핀: ["세부", "보라카이", "마닐라", "팔라완"],
      싱가포르: [],
      말레이시아: ["쿠알라룸푸르", "코타키나발루"],
      캄보디아: ["씨엠립"],
    },
  },
  유럽: {
    aliases: ["유럽", "유럽일주", "europe"],
    countries: {
      프랑스: ["파리", "니스"],
      이탈리아: ["로마", "베네치아", "피렌체", "밀라노"],
      스위스: ["인터라켄", "체르마트", "융프라우"],
      스페인: ["바르셀로나", "마드리드"],
      독일: ["뮌헨", "베를린", "프랑크푸르트"],
      영국: ["런던"],
      체코: ["프라하"],
      오스트리아: ["빈", "잘츠부르크"],
    },
  },
};

/**
 * 쿼리의 지리어를 destination 매칭용 토큰 집합으로 확장한다.
 *  - 권역어 적중 → 그 권역의 국가·도시 전체 (broad recall)
 *  - 국가어 적중 → 그 국가 + 하위 도시 (drill-down)
 *  - 도시어 적중 → 그 도시만 (precision; 역방향 확장 안 함)
 *  - 미적중 → [] (geo 부스트 비활성)
 */
export function expandGeoTerms(query: string): string[] {
  const norm = query.toLowerCase();
  const out = new Set<string>();

  for (const region of Object.values(GEO_TAXONOMY)) {
    const regionHit = region.aliases.some((a) =>
      norm.includes(a.toLowerCase())
    );

    if (regionHit) {
      for (const [country, cities] of Object.entries(region.countries)) {
        out.add(country);
        for (const city of cities) out.add(city);
      }
      continue;
    }

    for (const [country, cities] of Object.entries(region.countries)) {
      if (norm.includes(country.toLowerCase())) {
        out.add(country);
        for (const city of cities) out.add(city);
      } else {
        for (const city of cities) {
          if (norm.includes(city.toLowerCase())) out.add(city);
        }
      }
    }
  }

  return [...out];
}
