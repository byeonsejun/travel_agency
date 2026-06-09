import { Prisma, ProductStatus, DepartureStatus, InclusionKind } from "@prisma/client";

/**
 * themeProducts.ts — 홈 "테마별 기획전"(home-theme-bento) 4개 테마에 맞춘 상품 정의.
 *
 * 테마(검색 쿼리)별 3개씩 = 12개. 테마 키워드를 title/summary 에 심어 검색
 * (벡터 임베딩 + 키워드 ILIKE)이 해당 기획전에서 잘 노출되도록 한다.
 *  - 가족여행 → #가족 (router THEME_KEYWORDS 가족→가족 가산)
 *  - 허니문   → #허니문 (신혼→허니문 가산)
 *  - 나홀로 여행 → title/summary 의 "나홀로/혼자" 키워드·임베딩 매칭(라우터 태그 없음)
 *  - 주말 근거리 → 짧은 박수(1~2박)+근거리+title/summary 의 "주말/근거리" 매칭
 *
 * seed.ts(전체 재시드)와 add-theme-products.ts(현 DB 추가)가 공유한다.
 */

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
}

const INCLUDED_LABELS = [
  "왕복 항공권",
  "전 일정 호텔 숙박",
  "전 일정 조식",
  "공항 픽업/샌딩",
  "전담 가이드",
];
const EXCLUDED_LABELS = ["개인 여행자 보험", "개인 경비 및 쇼핑", "선택 관광 비용"];

function makeInclusions(): Prisma.InclusionCreateNestedManyWithoutProductInput {
  return {
    create: [
      ...INCLUDED_LABELS.map((label) => ({ kind: InclusionKind.INCLUDED, label })),
      ...EXCLUDED_LABELS.map((label) => ({ kind: InclusionKind.EXCLUDED, label })),
    ],
  };
}

/** nights+1 일치 일정을 생성(도착 → 관광 → 귀국). highlights 를 관광일에 순환 배치. */
function makeItinerary(
  city: string,
  nights: number,
  highlights: string[],
): Prisma.ItineraryDayCreateNestedManyWithoutProductInput {
  const total = nights + 1;
  const days = Array.from({ length: total }, (_, i) => {
    if (i === 0) {
      return {
        title: `인천 출발 / ${city} 도착`,
        accommodation: "호텔 체크인" as string | null,
        meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
        stops: [
          { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
          { time: "14:00", place: `${city} 공항`, description: "입국 수속 후 시내 이동" },
          { time: "19:00", place: "호텔 인근", description: "자유 시간 및 저녁 식사" },
        ],
      };
    }
    if (i === total - 1) {
      return {
        title: `${city} 출발 / 인천 도착`,
        accommodation: null as string | null,
        meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
        stops: [
          { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
          { time: "14:00", place: `${city} 공항`, description: "탑승 수속 및 귀국 출발" },
          { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
        ],
      };
    }
    const h = highlights[(i - 1) % highlights.length];
    return {
      title: `${city} 관광 — ${h}`,
      accommodation: "호텔" as string | null,
      meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
      stops: [
        { time: "09:00", place: h, description: `${h} 관광 및 체험` },
        { time: "14:00", place: `${city} 시내`, description: "자유 시간 및 쇼핑" },
        { time: "19:00", place: "현지 식당", description: "현지 요리로 저녁 식사" },
      ],
    };
  });

  return {
    create: days.map((day, i) => ({
      dayNumber: i + 1,
      title: day.title,
      accommodation: day.accommodation,
      meals: day.meals,
      stops: {
        create: day.stops.map((stop, j) => ({
          order: j + 1,
          time: stop.time,
          place: stop.place,
          description: stop.description,
        })),
      },
    })),
  };
}

/** 미래 2회 출발일(30/60일 후) 생성. priceChild ≈ 0.8 * priceAdult. */
function makeDepartures(
  today: Date,
  nights: number,
  priceAdult: number,
): Prisma.DepartureCreateNestedManyWithoutProductInput {
  const priceChild = Math.round((priceAdult * 0.8) / 10000) * 10000;
  return {
    create: [30, 60].map((offset) => ({
      departureDate: addDays(today, offset),
      returnDate: addDays(today, offset + nights),
      priceAdult,
      priceChild,
      capacity: 20,
      bookedSeats: 0,
      minPax: 8,
      status: DepartureStatus.SCHEDULED,
    })),
  };
}

type ThemeSpec = {
  title: string;
  summary: string;
  aiSummary: string;
  destination: string;
  destinationCode: string;
  city: string;
  nights: number;
  basePriceAdult: number;
  tags: string[];
  highlights: string[];
  heroSeed: string;
};

const SPECS: ThemeSpec[] = [
  // ── 가족여행 ────────────────────────────────────────────────
  {
    title: "괌 가족여행 워터파크 리조트 4박5일",
    summary:
      "온 가족이 즐기는 괌 가족여행. 워터파크와 키즈클럽을 갖춘 리조트에서 아이와 함께하는 물놀이 휴양과 투몬 비치 자유 시간.",
    aiSummary:
      "워터파크와 키즈클럽이 있는 리조트로 아이와 함께하기 좋은 괌 가족여행입니다.\n비행 4시간 거리에 시차가 거의 없어 어린 자녀와 부모님 모두 편안합니다.\n물놀이와 해변 휴양에 집중한 가족 맞춤 일정입니다.",
    destination: "괌, 미국",
    destinationCode: "GU",
    city: "괌",
    nights: 4,
    basePriceAdult: 1690000,
    tags: ["#가족", "#리조트", "#해변"],
    highlights: ["언더워터월드", "사랑의 절벽", "투몬 비치"],
    heroSeed: "guam-family",
  },
  {
    title: "다낭 가족 풀빌라 4박5일",
    summary:
      "프라이빗 풀빌라에서 즐기는 다낭 가족여행. 아이와 물놀이하고 바나힐과 호이안 올드타운을 둘러보는 가족 맞춤 일정.",
    aiSummary:
      "프라이빗 풀빌라에서 아이와 마음껏 물놀이할 수 있는 다낭 가족여행입니다.\n바나힐 케이블카와 호이안 등불거리로 온 가족이 즐길 거리가 풍부합니다.\n가성비 좋은 가족 휴양 패키지입니다.",
    destination: "다낭, 베트남",
    destinationCode: "VN-DAD",
    city: "다낭",
    nights: 4,
    basePriceAdult: 1290000,
    tags: ["#가족", "#풀빌라", "#휴양"],
    highlights: ["바나힐", "미케 비치", "호이안 올드타운"],
    heroSeed: "danang-family",
  },
  {
    title: "오키나와 가족 자유여행 3박4일",
    summary:
      "아이와 함께 가는 오키나와 가족여행. 츄라우미 수족관과 에메랄드빛 해변에서 즐기는 자유로운 가족 휴양.",
    aiSummary:
      "세계적 규모의 츄라우미 수족관으로 아이가 좋아하는 오키나와 가족여행입니다.\n비행 2시간 근거리에 자유 일정이 많아 아이 페이스에 맞추기 좋습니다.\n해변과 아메리칸 빌리지로 채우는 가족 자유 휴양입니다.",
    destination: "오키나와, 일본",
    destinationCode: "JP-OKA",
    city: "오키나와",
    nights: 3,
    basePriceAdult: 1190000,
    tags: ["#가족", "#해변", "#자유시간"],
    highlights: ["츄라우미 수족관", "아메리칸 빌리지", "만좌모"],
    heroSeed: "okinawa-family",
  },
  // ── 허니문 ──────────────────────────────────────────────────
  {
    title: "몰디브 허니문 수상빌라 5박7일",
    summary:
      "단둘이 떠나는 몰디브 허니문. 수상빌라에서 즐기는 프라이빗 휴양과 스노클링, 선셋 크루즈로 완성하는 신혼여행.",
    aiSummary:
      "프라이빗 수상빌라에서 단둘만의 시간을 보내는 몰디브 허니문입니다.\n맑은 바다에서의 스노클링과 선셋 크루즈로 로맨틱함을 더합니다.\n인생에 한 번뿐인 신혼여행을 위한 프리미엄 패키지입니다.",
    destination: "몰디브",
    destinationCode: "MV",
    city: "말레",
    nights: 5,
    basePriceAdult: 4590000,
    tags: ["#허니문", "#풀빌라", "#프리미엄"],
    highlights: ["수상빌라", "스노클링", "선셋 크루즈"],
    heroSeed: "maldives-honeymoon",
  },
  {
    title: "발리 허니문 풀빌라 4박6일",
    summary:
      "신혼부부를 위한 발리 허니문. 프라이빗 풀빌라와 우붓 정글, 로맨틱한 선셋 디너로 채우는 단둘만의 시간.",
    aiSummary:
      "프라이빗 풀빌라에서 머무는 신혼부부 맞춤 발리 허니문입니다.\n우붓의 초록빛 정글과 따나롯 사원 선셋이 로맨틱함을 완성합니다.\n합리적 가격대의 풀빌라 허니문 패키지입니다.",
    destination: "발리, 인도네시아",
    destinationCode: "ID-DPS",
    city: "발리",
    nights: 4,
    basePriceAdult: 2290000,
    tags: ["#허니문", "#풀빌라", "#휴양"],
    highlights: ["우붓", "따나롯 사원", "꾸따 비치"],
    heroSeed: "bali-honeymoon",
  },
  {
    title: "푸켓 허니문 럭셔리 리조트 4박5일",
    summary:
      "푸켓 5성급 리조트에서 즐기는 허니문. 피피섬 투어와 안다만해 선셋으로 완성하는 로맨틱 신혼여행.",
    aiSummary:
      "안다만해를 품은 5성급 리조트에서의 푸켓 허니문입니다.\n에메랄드빛 피피섬 투어와 선셋 디너로 로맨틱함을 더합니다.\n가까운 거리에 즐기는 프리미엄 신혼여행입니다.",
    destination: "푸켓, 태국",
    destinationCode: "TH-HKT",
    city: "푸켓",
    nights: 4,
    basePriceAdult: 1990000,
    tags: ["#허니문", "#리조트", "#프리미엄"],
    highlights: ["피피섬", "빠통 비치", "팡아만"],
    heroSeed: "phuket-honeymoon",
  },
  // ── 나홀로 여행 ─────────────────────────────────────────────
  {
    title: "혼자 떠나는 도쿄 나홀로 자유여행 3박4일",
    summary:
      "혼자라서 더 자유로운 도쿄 나홀로 여행. 시부야와 아사쿠사를 내 페이스대로 누비는 1인 맞춤 자유 일정.",
    aiSummary:
      "혼자만의 속도로 도쿄를 누비는 나홀로 자유여행입니다.\n시부야·아사쿠사·아키하바라를 자유롭게 탐방할 수 있습니다.\n1인 여행자를 위한 부담 없는 자유 일정 패키지입니다.",
    destination: "도쿄, 일본",
    destinationCode: "JP-TYO",
    city: "도쿄",
    nights: 3,
    basePriceAdult: 990000,
    tags: ["#나홀로", "#자유시간", "#도심"],
    highlights: ["시부야", "아사쿠사", "아키하바라"],
    heroSeed: "tokyo-solo",
  },
  {
    title: "방콕 나홀로 미식 자유여행 3박4일",
    summary:
      "혼자 즐기는 방콕 나홀로 미식 여행. 길거리 음식부터 루프톱 바까지, 나만의 속도로 누비는 자유 일정.",
    aiSummary:
      "길거리 음식부터 루프톱 바까지 즐기는 방콕 나홀로 미식 여행입니다.\n짜뚜짝 시장과 카오산 로드를 혼자 자유롭게 탐방합니다.\n1인 여행자를 위한 가성비 미식 자유 일정입니다.",
    destination: "방콕, 태국",
    destinationCode: "TH-BKK",
    city: "방콕",
    nights: 3,
    basePriceAdult: 890000,
    tags: ["#나홀로", "#미식", "#자유시간"],
    highlights: ["짜뚜짝 시장", "왓포", "카오산 로드"],
    heroSeed: "bangkok-solo",
  },
  {
    title: "다낭 나홀로 힐링 휴양 3박4일",
    summary:
      "혼자만의 시간이 필요할 때, 다낭 나홀로 힐링 휴양. 미케 비치에서 여유를 즐기는 1인 맞춤 자유 여행.",
    aiSummary:
      "미케 비치에서 여유롭게 쉬어가는 다낭 나홀로 힐링 휴양입니다.\n오행산과 한 시장을 혼자 자유롭게 둘러볼 수 있습니다.\n재충전이 필요한 1인 여행자를 위한 휴양 패키지입니다.",
    destination: "다낭, 베트남",
    destinationCode: "VN-DAD",
    city: "다낭",
    nights: 3,
    basePriceAdult: 850000,
    tags: ["#나홀로", "#휴양", "#자유시간"],
    highlights: ["미케 비치", "오행산", "한 시장"],
    heroSeed: "danang-solo",
  },
  // ── 주말 근거리 ─────────────────────────────────────────────
  {
    title: "후쿠오카 주말 근거리 1박2일",
    summary:
      "짧고 굵게 떠나는 후쿠오카 주말여행. 비행 1시간 근거리, 1박2일로 즐기는 라멘과 나카스 포장마차 미식 투어.",
    aiSummary:
      "비행 1시간 근거리로 주말 이틀이면 충분한 후쿠오카 여행입니다.\n나카스 포장마차와 라멘 골목으로 즐기는 미식 투어가 핵심입니다.\n짧고 굵게 다녀오기 좋은 근거리 주말 패키지입니다.",
    destination: "후쿠오카, 일본",
    destinationCode: "JP-FUK",
    city: "후쿠오카",
    nights: 1,
    basePriceAdult: 590000,
    tags: ["#근거리", "#미식", "#자유시간"],
    highlights: ["캐널시티", "다자이후"],
    heroSeed: "fukuoka-weekend",
  },
  {
    title: "오사카 주말 근거리 2박3일",
    summary:
      "주말 이틀이면 충분한 오사카 근거리 여행. 도톤보리 야경과 신사이바시 쇼핑으로 알차게 채우는 2박3일.",
    aiSummary:
      "비행 1시간대 근거리로 주말에 다녀오기 좋은 오사카 여행입니다.\n도톤보리 야경과 신사이바시 쇼핑을 알차게 즐깁니다.\n짧고 굵은 근거리 주말 자유 일정입니다.",
    destination: "오사카, 일본",
    destinationCode: "JP-OSA",
    city: "오사카",
    nights: 2,
    basePriceAdult: 790000,
    tags: ["#근거리", "#도심", "#자유시간"],
    highlights: ["도톤보리", "오사카성", "신사이바시"],
    heroSeed: "osaka-weekend",
  },
  {
    title: "타이베이 주말 근거리 미식 2박3일",
    summary:
      "주말 근거리 타이베이 미식 여행. 스린 야시장과 지우펀, 딤섬까지 2박3일로 즐기는 짧고 굵은 미식 투어.",
    aiSummary:
      "비행 2시간대 근거리로 주말에 다녀오기 좋은 타이베이 여행입니다.\n스린 야시장과 지우펀, 딤섬으로 채우는 미식 투어가 핵심입니다.\n짧고 굵게 즐기는 근거리 주말 미식 패키지입니다.",
    destination: "타이베이, 대만",
    destinationCode: "TW-TPE",
    city: "타이베이",
    nights: 2,
    basePriceAdult: 690000,
    tags: ["#근거리", "#미식", "#자유시간"],
    highlights: ["스린 야시장", "지우펀", "101 타워"],
    heroSeed: "taipei-weekend",
  },
];

/** 12개 테마 상품의 Prisma create input 을 만든다(today 기준 출발일). */
export function buildThemeProducts(today: Date): Prisma.ProductCreateInput[] {
  return SPECS.map((s) => ({
    title: s.title,
    summary: s.summary,
    aiSummary: s.aiSummary,
    destination: s.destination,
    destinationCode: s.destinationCode,
    durationNights: s.nights,
    durationDays: s.nights + 1,
    heroImageUrl: `https://picsum.photos/seed/${s.heroSeed}/800/500`,
    status: ProductStatus.PUBLISHED,
    basePriceAdult: s.basePriceAdult,
    tags: { create: s.tags.map((tag) => ({ tag })) },
    inclusions: makeInclusions(),
    itineraryDays: makeItinerary(s.city, s.nights, s.highlights),
    departures: makeDepartures(today, s.nights, s.basePriceAdult),
  }));
}

/** 추가 스크립트의 멱등 처리를 위한 제목 목록. */
export const THEME_PRODUCT_TITLES: string[] = SPECS.map((s) => s.title);
