/**
 * query-catalog.ts — 확장 골든 쿼리 카탈로그 (변별력 확보용, 라벨 없음).
 *
 * 목적: 기존 golden 10건은 nDCG가 포화(다수 1.000)되어 가중치 우열을 못 가린다.
 * 코퍼스(현 DB PUBLISHED 20건)가 실제로 지지하는 차원만 "자극"하는 쿼리를
 * 아키타입별로 균형 분배해, 가중치 격자(286)의 nDCG 스프레드를 벌린다.
 *
 * ⚠️ 이 파일은 쿼리 텍스트 + 아키타입 + 의도 + 그라운딩만 담는다. **라벨은 없다.**
 *    관련성 라벨은 LLM-as-judge(judge.ts)가 생성해 judge-labels.fixture.json에 박제.
 *    수작업 라벨(golden-queries.ts)은 judge↔수작업 일치도 검증용으로 보존된다.
 *
 * 그라운딩 원칙(설계 §2):
 *  - 코퍼스에 실제 존재하는 차원만 자극(카탈로그가 답할 수 없는 쿼리 금지).
 *  - 각 쿼리는 ruleBasedRoute의 신호 프로파일로 아키타입이 결정론적으로 분류되며,
 *    queryCatalog.test.ts가 선언 아키타입 == 라우팅 분류를 강제(grounding 가드).
 *
 * 코퍼스 인벤토리(20건, extract-fixtures 추출 시점):
 *  - 국가/권역: 일본 6(오사카2·도쿄2·후쿠오카·오키나와) · 동남아 9(태국3·베트남3·인니2·필리핀1)
 *               · 유럽 2(파리로마·스위스) · 대만1 · 괌1 · 몰디브1
 *    (주의: 대만·괌·몰디브는 gazetteer 미수록 → geo 부스트 불가, 벡터/테마/키워드 의존)
 *  - 테마(빈도): 자유시간8 · 가족5 · 휴양4 · 허니문4 · 프리미엄4 · 풀빌라4 · 해변3 · 미식3
 *               · 리조트3 · 도심3 · 나홀로3 · 근거리3 · 노쇼핑2 · (온천·설경·가성비·스노클링 등 1)
 *  - 기간(박): 1박1 · 2박2 · 3박5 · 4박7 · 5박3 · 8박1 · 9박1
 *  - 가격: 59~499만 (≤100만 7건 · 100~200만 8건 · >200만 5건)
 *
 * 아키타입별 코퍼스 지지 가능 개수(인벤토리 근거) / 본 카탈로그 채택 수:
 *  - pure-semantic (무신호, 벡터 단독)     : 사실상 무제한(의미축) / 9 (기존1 + 신규8)
 *  - geo-dominant  (geo만)                : 일본·동남아·유럽 등 ~10 / 8
 *  - theme-dominant(theme만)              : 13개 다빈도 태그 / 11 (기존4 + 신규7)
 *  - constraint    (기간/가격만)          : price 3버킷·duration 5버킷 / 7
 *  - adversarial   (≥2 신호 경합)         : geo×theme×filter 조합 / 10 (기존5 + 신규5)
 */

/** 컴포넌트 변별 아키타입 — 어떤 가중치 축을 자극하는지로 분류. */
export type Archetype =
  | "pure-semantic" // geo·theme·filter 무신호 → 벡터 가중치 단독 변별 ⭐
  | "geo-dominant" // geo만 → geo 가중치 변별
  | "theme-dominant" // theme만 → theme 가중치 변별
  | "constraint" // 기간/가격 하드필터만 → 필터×벡터 상호작용
  | "adversarial"; // ≥2 신호 경합 → 가중치 밸런스 텐션 ⭐

export interface QuerySpec {
  /** 원본 쿼리(라벨/임베딩 조인 키). */
  query: string;
  /** 선언 아키타입 — 라우팅 분류와 일치해야 함(queryCatalog.test.ts 가드). */
  archetype: Archetype;
  /** 검증 표적(문서용). */
  intent: string;
  /** 코퍼스 지지 근거 — 어떤 상품/차원을 자극하는지(answerability). */
  grounding: string;
}

export const QUERY_CATALOG: QuerySpec[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // (a) pure-semantic — geo·theme·filter 무신호. 벡터만이 의미를 잡는 zone ⭐
  //     기존 golden "조용히 쉬고 싶어" 1건 + 신규 8건.
  // ─────────────────────────────────────────────────────────────────────────
  {
    query: "조용히 쉬고 싶어",
    archetype: "pure-semantic",
    intent: "추상 휴식 — 벡터 단독 기여 격리(기존 golden)",
    grounding: "힐링·휴양 상품(다낭 힐링·발리·온천)을 의미로만 매칭",
  },
  {
    query: "푹 쉬다 오고 싶어",
    archetype: "pure-semantic",
    intent: "추상 휴식·재충전",
    grounding: "휴양·힐링 상품군(휴양4·온천1)",
  },
  {
    query: "탁 트인 풍경이 보고 싶어",
    archetype: "pure-semantic",
    intent: "추상 절경·자연",
    grounding: "알프스·수상빌라·해변 절경 상품",
  },
  {
    query: "이색적인 경험을 원해",
    archetype: "pure-semantic",
    intent: "추상 체험·새로움",
    grounding: "해양스포츠(세부)·문화(파리로마)·미식 체험형",
  },
  {
    query: "여유롭게 멍때리고 싶다",
    archetype: "pure-semantic",
    intent: "추상 슬로우·무위",
    grounding: "휴양·풀빌라 한적형(발리·다낭·몰디브)",
  },
  {
    query: "아무 생각 없이 떠나고 싶어",
    archetype: "pure-semantic",
    intent: "추상 탈출·리트릿",
    grounding: "휴양·나홀로 힐링 상품",
  },
  {
    query: "오붓하게 둘이서 보내고 싶어",
    archetype: "pure-semantic",
    intent: "추상 로맨틱·프라이빗",
    grounding: "허니문·수상/풀빌라 프라이빗 상품(허니문4)",
  },
  {
    query: "도시를 벗어나 한적하게",
    archetype: "pure-semantic",
    intent: "추상 한적·탈도심",
    grounding: "휴양·자연형(발리·몰디브·스위스) — 도심형과 대비",
  },
  {
    query: "활력을 되찾고 싶어",
    archetype: "pure-semantic",
    intent: "추상 재충전·기운",
    grounding: "휴양·힐링·해양 액티브 혼합",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // (b) geo-dominant — geo 신호만. geo 가중치를 단독 변별.
  //     대만·괌·몰디브는 gazetteer 미수록이라 pure-geo 불가(의도적 제외).
  // ─────────────────────────────────────────────────────────────────────────
  {
    query: "일본 여행 추천",
    archetype: "geo-dominant",
    intent: "geo 국가-앵커(일본 6건)",
    grounding: "오사카·도쿄·후쿠오카·오키나와 6건이 geo 부스트 대상",
  },
  {
    query: "베트남 가고 싶어",
    archetype: "geo-dominant",
    intent: "geo 국가(베트남)",
    grounding: "다낭 3건(가족·힐링·노쇼핑)",
  },
  {
    query: "태국 여행",
    archetype: "geo-dominant",
    intent: "geo 국가(태국)",
    grounding: "푸켓 2건 + 방콕 1건",
  },
  {
    query: "발리로 떠나고 싶어",
    archetype: "geo-dominant",
    intent: "geo 도시(발리, drill-down)",
    grounding: "발리 가성비·허니문 2건",
  },
  {
    query: "동남아 어디가 좋을까",
    archetype: "geo-dominant",
    intent: "geo 권역(동남아 9건 broad recall)",
    grounding: "태국·베트남·인니·필리핀 9건 전체",
  },
  {
    query: "도쿄 가보고 싶어",
    archetype: "geo-dominant",
    intent: "geo 도시(도쿄)",
    grounding: "도쿄 하코네온천·나홀로 2건",
  },
  {
    query: "다낭 여행 갈래",
    archetype: "geo-dominant",
    intent: "geo 도시(다낭)",
    grounding: "다낭 3건",
  },
  {
    query: "푸켓 가고 싶어",
    archetype: "geo-dominant",
    intent: "geo 도시(푸켓)",
    grounding: "푸켓 풀빌라허니문·럭셔리리조트 2건",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // (c) theme-dominant — theme 신호만. theme 가중치를 단독 변별.
  //     기존 golden 4건(효도온천료칸·신혼풀빌라리조트·스노클링해변휴양·혼자근거리주말)
  //     + 신규 7건. 희소 태그(온천·가성비)는 precision 변별용.
  // ─────────────────────────────────────────────────────────────────────────
  {
    query: "효도 여행 온천 료칸",
    archetype: "theme-dominant",
    intent: "theme 다중(부모님·온천·료칸) 단일정답(기존 golden)",
    grounding: "도쿄·하코네 온천(온천·부모님·료칸 전부 적중)",
  },
  {
    query: "신혼 풀빌라 리조트",
    archetype: "theme-dominant",
    intent: "theme 다중(허니문·풀빌라·리조트) 다수정답(기존 golden)",
    grounding: "허니문 4건 + 풀빌라/리조트 교차",
  },
  {
    query: "스노클링 해변 휴양",
    archetype: "theme-dominant",
    intent: "theme 다중(스노클링·해변·휴양) 커버리지(기존 golden)",
    grounding: "세부(스노클링·해양)·해변3·휴양4",
  },
  {
    query: "혼자 떠나는 근거리 주말",
    archetype: "theme-dominant",
    intent: "theme(나홀로·근거리) 텐션(기존 golden)",
    grounding: "나홀로3·근거리3 교차",
  },
  {
    query: "가족 여행 추천",
    archetype: "theme-dominant",
    intent: "theme 단일 고빈도(가족 5건)",
    grounding: "가족 태그 5건(세부·괌·다낭·오키나와 등)",
  },
  {
    query: "허니문 어디로 갈까",
    archetype: "theme-dominant",
    intent: "theme 단일(허니문 4건)",
    grounding: "허니문 4건(푸켓·발리·몰디브)",
  },
  {
    query: "휴양하고 싶어",
    archetype: "theme-dominant",
    intent: "theme 단일(휴양 4건)",
    grounding: "휴양 태그 4건",
  },
  {
    query: "풀빌라에서 묵고 싶어",
    archetype: "theme-dominant",
    intent: "theme 단일(풀빌라 4건)",
    grounding: "풀빌라 4건",
  },
  {
    query: "온천 가고 싶다",
    archetype: "theme-dominant",
    intent: "theme 희소(온천 1건) — precision 변별",
    grounding: "도쿄·하코네 온천 단일 정답",
  },
  {
    query: "미식 여행 가고 싶어",
    archetype: "theme-dominant",
    intent: "theme 단일(미식 3건)",
    grounding: "방콕·후쿠오카·타이베이 미식 3건",
  },
  {
    query: "가성비 좋은 여행",
    archetype: "theme-dominant",
    intent: "theme 희소(가성비 1건) — precision 변별",
    grounding: "발리 가성비 단일 정답 + 저가 인접",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // (d) constraint — 기간/가격 하드필터만. 필터×벡터 상호작용 변별.
  //     price/duration 토큰은 cleanedQuery에서 제거 → 벡터는 잔여 의미만.
  // ─────────────────────────────────────────────────────────────────────────
  {
    query: "100만원 이하 여행",
    archetype: "constraint",
    intent: "가격 상한(≤100만 7건)",
    grounding: "59~99만 7건 통과, 그 외 배제",
  },
  {
    query: "150만원 이하로 다녀올 곳",
    archetype: "constraint",
    intent: "가격 상한(≤150만)",
    grounding: "≤150만 약 12건 통과",
  },
  {
    query: "80만원으로 다녀올 곳",
    archetype: "constraint",
    intent: "가격 상한(≤80만) — 저가 컷",
    grounding: "59·69·79만 3건만 통과",
  },
  {
    query: "1박2일 짧게",
    archetype: "constraint",
    intent: "기간 하한(1박, ±1 → 1~2박)",
    grounding: "후쿠오카1·오사카2박·타이베이2박 3건",
  },
  {
    query: "2박3일 여행",
    archetype: "constraint",
    intent: "기간(2박, ±1 → 2~3박)",
    grounding: "2~3박 7건",
  },
  {
    query: "3박4일 여행",
    archetype: "constraint",
    intent: "기간(3박, ±1 → 3~4박)",
    grounding: "3~4박 12건(가장 큰 버킷)",
  },
  {
    query: "5박 일정",
    archetype: "constraint",
    intent: "기간(5박, ±1 → 5~6박) — 장기 컷",
    grounding: "다낭호이안·푸켓풀빌라·몰디브 5박 3건",
  },

  // ─────────────────────────────────────────────────────────────────────────
  // (e) adversarial — ≥2 신호 경합. 가중치 밸런스 텐션을 만들어 스프레드 확대 ⭐
  //     기존 golden 5건 + 신규 5건.
  // ─────────────────────────────────────────────────────────────────────────
  {
    query: "가족과 함께하는 오사카 주말 여행",
    archetype: "adversarial",
    intent: "geo(오사카)×theme(가족·근거리) 경합(기존 golden)",
    grounding: "오사카 주말 vs 가족 — 완벽 교집합 부재",
  },
  {
    query: "동남아 휴양",
    archetype: "adversarial",
    intent: "geo(동남아 권역)×theme(휴양)(기존 golden)",
    grounding: "동남아 9건 중 휴양 태깅 상품 상위",
  },
  {
    query: "오사카 맛집 투어",
    archetype: "adversarial",
    intent: "geo(오사카)×theme(미식)(기존 golden)",
    grounding: "오사카 2건 vs 미식 3건(타지역) 경합",
  },
  {
    query: "3박4일 일본 여행",
    archetype: "adversarial",
    intent: "filter(기간)×geo(일본)(기존 golden)",
    grounding: "≤4박 통과 + 일본 6건 교집합",
  },
  {
    query: "설경 보러 일본",
    archetype: "adversarial",
    intent: "theme(설경 희소)×geo(일본)(기존 golden)",
    grounding: "설경×일본 부재 → 일본 겨울감(하코네) 최선",
  },
  {
    query: "일본 온천 여행",
    archetype: "adversarial",
    intent: "geo(일본 6)×theme(온천 1) 경합",
    grounding: "도쿄 하코네온천(교집합) vs 일본 일반",
  },
  {
    query: "동남아 허니문 풀빌라",
    archetype: "adversarial",
    intent: "geo(동남아)×theme(허니문·풀빌라)",
    grounding: "발리·푸켓 허니문풀빌라(동남아) vs 몰디브(권역 밖 테마)",
  },
  {
    query: "태국 허니문 리조트",
    archetype: "adversarial",
    intent: "geo(태국)×theme(허니문·리조트)",
    grounding: "푸켓 허니문 럭셔리리조트 교집합",
  },
  {
    query: "발리 허니문 풀빌라",
    archetype: "adversarial",
    intent: "geo(발리)×theme(허니문·풀빌라) 완벽 교집합",
    grounding: "발리 허니문 풀빌라 단일 최적",
  },
  {
    query: "오사카 가족 여행",
    archetype: "adversarial",
    intent: "geo(오사카)×theme(가족) 무교집합 텐션 ⭐",
    grounding: "오사카 2건(가족 무태깅) vs 가족 5건(타지역) — 가중치 의존",
  },
];
