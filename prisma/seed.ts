import { PrismaClient, ProductStatus, DepartureStatus, InclusionKind, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

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

const EXCLUDED_LABELS = [
  "개인 여행자 보험",
  "개인 경비 및 쇼핑",
  "선택 관광 비용",
];

function makeInclusions() {
  return {
    create: [
      ...INCLUDED_LABELS.map((label) => ({ kind: InclusionKind.INCLUDED, label })),
      ...EXCLUDED_LABELS.map((label) => ({ kind: InclusionKind.EXCLUDED, label })),
    ],
  };
}

function makeDays(
  days: Array<{
    title: string;
    accommodation: string | null;
    meals: { breakfast: string; lunch: string; dinner: string };
    stops: Array<{ time: string; place: string; description: string }>;
  }>
) {
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

async function main() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Cleanup in FK reverse order
  await prisma.$transaction([
    prisma.payment.deleteMany(),
    prisma.bookingEvent.deleteMany(),
    prisma.bookingTerms.deleteMany(),
    prisma.traveler.deleteMany(),
    prisma.booking.deleteMany(),
    prisma.itineraryStop.deleteMany(),
    prisma.itineraryDay.deleteMany(),
    prisma.inclusion.deleteMany(),
    prisma.productTag.deleteMany(),
    prisma.productEmbedding.deleteMany(),
    prisma.departure.deleteMany(),
    prisma.product.deleteMany(),
    prisma.session.deleteMany(),
    prisma.account.deleteMany(),
    prisma.verificationToken.deleteMany(),
    prisma.passportProfile.deleteMany(),
    prisma.user.deleteMany(),
  ]);

  // ─── Users (M-AUTH 검증용) ───────────────────────────────────
  await prisma.user.createMany({
    data: [
      {
        email: "customer@nextour.test",
        name: "테스트 고객",
        role: UserRole.CUSTOMER,
        emailVerified: today,
      },
      {
        email: "admin@nextour.test",
        name: "테스트 관리자",
        role: UserRole.ADMIN,
        emailVerified: today,
      },
    ],
  });
  console.log("Seed users: customer@nextour.test, admin@nextour.test");

  // ─── Product 1: 오사카·교토 3박4일 ───────────────────────────
  await prisma.product.create({
    data: {
      title: "오사카·교토 3박4일 자유일정",
      summary:
        "쇼핑 압박 없는 오사카·교토 자유 여행. 도톤보리, 아라시야마, 후시미이나리를 자유롭게 탐방합니다.",
      aiSummary:
        "쇼핑 압박 없이 오사카 도톤보리, 교토 아라시야마를 자유롭게 누비는 일정입니다.\n전문 가이드가 함께하되 자유 시간이 충분해 나만의 여행을 즐길 수 있습니다.\n가족·커플·친구 모두에게 딱 맞는 균형 잡힌 패키지입니다.",
      destination: "오사카, 일본",
      destinationCode: "JP-OSA",
      durationNights: 3,
      durationDays: 4,
      heroImageUrl: "https://picsum.photos/seed/osaka-kyoto/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 1290000,
      tags: { create: [{ tag: "#노쇼핑" }, { tag: "#자유시간" }, { tag: "#도심" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 오사카 도착",
          accommodation: "호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "14:00", place: "오사카 간사이 공항", description: "입국 수속 후 시내 이동" },
            { time: "19:00", place: "도톤보리", description: "도톤보리 야경 감상 및 저녁 식사" },
          ],
        },
        {
          title: "교토 당일 관광",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "아라시야마 대나무숲", description: "대나무 숲길 산책 및 관광" },
            { time: "14:00", place: "후시미이나리 대사", description: "수천 개의 도리이 터널 탐방" },
            { time: "19:00", place: "기온 거리", description: "게이샤 거리 야경 감상 및 저녁 식사" },
          ],
        },
        {
          title: "오사카 주요 관광",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "오사카성", description: "오사카성 천수각 전망 및 성곽 관람" },
            { time: "14:00", place: "신사이바시", description: "오사카 최대 쇼핑 거리 자유 탐방" },
            { time: "19:00", place: "구로몬 시장 인근 식당", description: "오사카 현지 요리로 저녁 식사" },
          ],
        },
        {
          title: "오사카 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "간사이 공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 30),
            returnDate: addDays(today, 33),
            priceAdult: 1290000,
            priceChild: 990000,
            capacity: 20,
            bookedSeats: 8,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 60),
            returnDate: addDays(today, 63),
            priceAdult: 1290000,
            priceChild: 990000,
            capacity: 20,
            bookedSeats: 3,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 2: 도쿄·하코네 온천 4박5일 ─────────────────────
  await prisma.product.create({
    data: {
      title: "도쿄·하코네 온천 4박5일",
      summary:
        "도쿄 관광 후 하코네 료칸 온천을 즐기는 부모님 효도 여행. 후지산 뷰와 노천탕이 하이라이트입니다.",
      aiSummary:
        "도쿄 관광 후 하코네 료칸에서 온천을 즐기는 부모님 효도 여행 코스입니다.\n후지산 뷰와 노천탕을 동시에 즐길 수 있는 프리미엄 료칸을 선정했습니다.\n이동 동선을 최소화해 어르신들도 편안하게 즐길 수 있습니다.",
      destination: "도쿄, 일본",
      destinationCode: "JP-TYO",
      durationNights: 4,
      durationDays: 5,
      heroImageUrl: "https://picsum.photos/seed/tokyo-hakone/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 1590000,
      tags: { create: [{ tag: "#온천" }, { tag: "#부모님" }, { tag: "#료칸" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 도쿄 도착",
          accommodation: "호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "13:00", place: "나리타 국제공항", description: "입국 수속 후 시내 이동" },
            { time: "19:00", place: "신주쿠 이자카야", description: "도쿄 현지 이자카야에서 저녁 식사" },
          ],
        },
        {
          title: "도쿄 주요 관광",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "아사쿠사 센소지", description: "도쿄 대표 사원 관람 및 나카미세 상점가 탐방" },
            { time: "14:00", place: "우에노 공원", description: "우에노 공원 산책 및 박물관 관람" },
            { time: "19:00", place: "긴자 레스토랑", description: "긴자에서 일식 코스 저녁 식사" },
          ],
        },
        {
          title: "하코네 이동 및 온천",
          accommodation: "하코네 료칸",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "신주쿠역", description: "로맨스카로 하코네 이동" },
            { time: "14:00", place: "하코네 오픈에어 뮤지엄", description: "야외 조각 공원 관람" },
            { time: "19:00", place: "료칸 노천탕", description: "후지산 뷰 노천탕에서 온천 체험" },
          ],
        },
        {
          title: "하코네 관광 / 도쿄 귀환",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "아시 호수", description: "유람선 타고 후지산 전망 감상" },
            { time: "14:00", place: "오다와라성", description: "하코네 인근 오다와라성 관람" },
            { time: "19:00", place: "도쿄 신주쿠", description: "신주쿠 돌아와 저녁 식사" },
          ],
        },
        {
          title: "도쿄 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "나리타 국제공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 45),
            returnDate: addDays(today, 49),
            priceAdult: 1590000,
            priceChild: 1190000,
            capacity: 16,
            bookedSeats: 14,
            minPax: 8,
            status: DepartureStatus.CONFIRMED,
          },
          {
            departureDate: addDays(today, 75),
            returnDate: addDays(today, 79),
            priceAdult: 1590000,
            priceChild: 1190000,
            capacity: 16,
            bookedSeats: 2,
            minPax: 8,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 3: 다낭·호이안 5박6일 ──────────────────────────
  await prisma.product.create({
    data: {
      title: "다낭·호이안 5박6일 노쇼핑",
      summary:
        "다낭 해변과 호이안 구시가지를 쇼핑 없이 자유롭게 탐방하는 가족 여행. 바나힐, 미케 비치가 하이라이트.",
      aiSummary:
        "다낭 해변과 호이안 구시가지를 쇼핑 없이 자유롭게 탐방하는 가족 여행입니다.\n미케 비치에서의 여유로운 오전과 바나힐 테마파크 방문이 하이라이트입니다.\n현지 요리 클래스와 야시장 탐방으로 베트남 문화를 깊이 체험합니다.",
      destination: "다낭, 베트남",
      destinationCode: "VN-DAD",
      durationNights: 5,
      durationDays: 6,
      heroImageUrl: "https://picsum.photos/seed/danang-hoian/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 1190000,
      tags: { create: [{ tag: "#노쇼핑" }, { tag: "#가족" }, { tag: "#해변" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 다낭 도착",
          accommodation: "호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "13:00", place: "다낭 국제공항", description: "입국 수속 후 호텔 이동" },
            { time: "19:00", place: "한 강변 레스토랑", description: "다낭 한 강 야경 감상 및 저녁 식사" },
          ],
        },
        {
          title: "바나힐 테마파크",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "바나힐 케이블카 탑승장", description: "세계 최장 케이블카로 바나힐 정상 이동" },
            { time: "14:00", place: "골든 브릿지", description: "거대한 손 위의 황금 다리 포토존 방문" },
            { time: "19:00", place: "다낭 콩 카페", description: "베트남 코코넛 커피와 함께 저녁 휴식" },
          ],
        },
        {
          title: "호이안 구시가지 탐방",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "호이안 내원교", description: "호이안 랜드마크 일본교 관람" },
            { time: "14:00", place: "호이안 야시장", description: "형형색색 등불과 전통 수공예품 탐방" },
            { time: "19:00", place: "호이안 요리 클래스", description: "베트남 전통 요리 만들기 체험" },
          ],
        },
        {
          title: "미케 비치 자유 시간",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "미케 비치", description: "세계 6대 해변 미케 비치에서 자유 시간" },
            { time: "14:00", place: "참조각 박물관", description: "베트남 참족 유물 박물관 관람" },
            { time: "19:00", place: "해산물 레스토랑", description: "다낭 신선한 해산물로 저녁 식사" },
          ],
        },
        {
          title: "다낭 주요 관광",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "오행산(마블 마운틴)", description: "석회암 산 동굴과 사원 탐방" },
            { time: "14:00", place: "다낭 대성당", description: "프랑스 식민지 시대 핑크 성당 관람" },
            { time: "19:00", place: "콘 마켓 인근 식당", description: "베트남 반쎄오와 미꽝으로 저녁 식사" },
          ],
        },
        {
          title: "다낭 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "다낭 국제공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 30),
            returnDate: addDays(today, 35),
            priceAdult: 1190000,
            priceChild: 890000,
            capacity: 24,
            bookedSeats: 5,
            minPax: 12,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 60),
            returnDate: addDays(today, 65),
            priceAdult: 1190000,
            priceChild: 890000,
            capacity: 24,
            bookedSeats: 12,
            minPax: 12,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 90),
            returnDate: addDays(today, 95),
            priceAdult: 1190000,
            priceChild: 890000,
            capacity: 24,
            bookedSeats: 0,
            minPax: 12,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 4: 푸켓 풀빌라 허니문 5박7일 ──────────────────
  await prisma.product.create({
    data: {
      title: "푸켓 풀빌라 허니문 5박7일",
      summary:
        "프라이빗 풀빌라에서 즐기는 럭셔리 허니문. 팡아만 선셋 크루즈와 스파가 포함된 프리미엄 패키지.",
      aiSummary:
        "프라이빗 풀빌라에서 즐기는 럭셔리 허니문 패키지입니다.\n팡아만 선셋 크루즈와 빅부다 일출 투어가 낭만을 더해줍니다.\n커플만을 위한 스파와 캔들라이트 디너가 포함된 프리미엄 구성입니다.",
      destination: "푸켓, 태국",
      destinationCode: "TH-HKT",
      durationNights: 5,
      durationDays: 7,
      heroImageUrl: "https://picsum.photos/seed/phuket-villa/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 2490000,
      tags: { create: [{ tag: "#허니문" }, { tag: "#프리미엄" }, { tag: "#풀빌라" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 푸켓 도착",
          accommodation: "풀빌라 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "15:00", place: "푸켓 국제공항", description: "입국 수속 후 프라이빗 풀빌라 이동" },
            { time: "19:00", place: "풀빌라 레스토랑", description: "캔들라이트 웰컴 디너" },
          ],
        },
        {
          title: "빅부다 & 까따 비치",
          accommodation: "풀빌라",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "빅부다 사원", description: "푸켓 최고 전망 포인트에서 일출 감상" },
            { time: "14:00", place: "까따 비치", description: "에메랄드빛 바다에서 스노클링 체험" },
            { time: "19:00", place: "까따 레스토랑", description: "태국 씨푸드 요리로 저녁 식사" },
          ],
        },
        {
          title: "팡아만 선셋 크루즈",
          accommodation: "풀빌라",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "제임스본드 섬", description: "팡아만 석회암 섬 보트 투어" },
            { time: "14:00", place: "코 파냐이", description: "수상 마을 탐방 및 카약 체험" },
            { time: "19:00", place: "선셋 크루즈", description: "팡아만 황금빛 선셋 크루즈 디너" },
          ],
        },
        {
          title: "커플 스파 & 자유 시간",
          accommodation: "풀빌라",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "풀빌라 수영장", description: "프라이빗 수영장에서 여유로운 오전" },
            { time: "14:00", place: "트로피컬 스파", description: "90분 커플 타이 마사지 & 아로마 스파" },
            { time: "19:00", place: "파통 비치 레스토랑", description: "파통 해변가 레스토랑에서 저녁 식사" },
          ],
        },
        {
          title: "프라이야 비치 자유 일정",
          accommodation: "풀빌라",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "프라이야 비치", description: "푸켓 숨겨진 비밀 해변 탐방" },
            { time: "14:00", place: "올드타운 푸켓", description: "시노-포르투갈 건축물 감상 및 카페 탐방" },
            { time: "19:00", place: "루프탑 바", description: "푸켓 야경과 함께 칵테일 저녁" },
          ],
        },
        {
          title: "푸켓 관광 / 공항 이동",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "왓 찰롱", description: "푸켓 가장 유명한 사원 관람" },
            { time: "14:00", place: "까론 뷰포인트", description: "푸켓 3개 해변 한눈에 감상" },
            { time: "19:00", place: "공항 인근 레스토랑", description: "마지막 태국 요리로 저녁 식사" },
          ],
        },
        {
          title: "푸켓 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "푸켓 국제공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 30),
            returnDate: addDays(today, 36),
            priceAdult: 2490000,
            priceChild: 1990000,
            capacity: 4,
            bookedSeats: 2,
            minPax: 2,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 60),
            returnDate: addDays(today, 66),
            priceAdult: 2490000,
            priceChild: 1990000,
            capacity: 4,
            bookedSeats: 0,
            minPax: 2,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 5: 파리·로마 핵심 8박9일 ───────────────────────
  await prisma.product.create({
    data: {
      title: "파리·로마 핵심 8박9일",
      summary:
        "파리 에펠탑·루브르부터 로마 콜로세움·바티칸까지. 특급 호텔과 TGV 열차 포함 품격 유럽 여행.",
      aiSummary:
        "파리 에펠탑·루브르부터 로마 콜로세움·바티칸까지 유럽 핵심 명소를 담았습니다.\n현지 전문 가이드와 함께하는 소규모 투어로 깊이 있는 역사 이야기를 들을 수 있습니다.\n특급 호텔과 TGV 고속열차 이동이 포함된 품격 있는 유럽 여행입니다.",
      destination: "파리·로마, 유럽",
      destinationCode: "EU-FR-IT",
      durationNights: 8,
      durationDays: 9,
      heroImageUrl: "https://picsum.photos/seed/paris-rome/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 3990000,
      tags: { create: [{ tag: "#유럽" }, { tag: "#역사" }, { tag: "#문화" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 파리 도착",
          accommodation: "파리 특급 호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "16:00", place: "샤를 드 골 공항", description: "입국 수속 후 파리 시내 이동" },
            { time: "19:00", place: "샹젤리제 비스트로", description: "파리 도착 기념 프랑스 요리로 저녁 식사" },
          ],
        },
        {
          title: "파리 에펠탑 & 루브르",
          accommodation: "파리 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "에펠탑", description: "세계적 랜드마크 에펠탑 전망대 방문" },
            { time: "14:00", place: "루브르 박물관", description: "모나리자, 밀로의 비너스 등 세계적 작품 감상" },
            { time: "19:00", place: "센 강변 레스토랑", description: "센 강 야경과 함께 프랑스 코스 요리" },
          ],
        },
        {
          title: "파리 몽마르트 & 오르세",
          accommodation: "파리 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "몽마르트 사크레쾨르", description: "파리 언덕 위 대성당과 예술가 거리 탐방" },
            { time: "14:00", place: "오르세 미술관", description: "모네, 르누아르 인상파 걸작 감상" },
            { time: "19:00", place: "생제르맹 카페", description: "파리 문화 중심지 생제르맹에서 저녁 식사" },
          ],
        },
        {
          title: "베르사유 궁전",
          accommodation: "파리 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "베르사유 궁전", description: "루이 14세의 화려한 궁전과 정원 탐방" },
            { time: "14:00", place: "마리 앙투아네트의 정원", description: "왕비의 비밀 정원 산책" },
            { time: "19:00", place: "파리 시내 레스토랑", description: "파리 마지막 저녁 프랑스 식사" },
          ],
        },
        {
          title: "파리→로마 이동 (TGV)",
          accommodation: "로마 특급 호텔 체크인",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "파리 리옹역", description: "TGV 고속열차로 이탈리아 이동" },
            { time: "14:00", place: "로마 테르미니역", description: "로마 도착 후 호텔 이동" },
            { time: "19:00", place: "트라스테베레 레스토랑", description: "로마 전통 구역에서 이탈리아 정통 파스타" },
          ],
        },
        {
          title: "로마 콜로세움 & 포럼",
          accommodation: "로마 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "콜로세움", description: "로마 제국의 상징 원형경기장 전문 가이드 투어" },
            { time: "14:00", place: "로마 포럼", description: "고대 로마 정치 중심지 유적 탐방" },
            { time: "19:00", place: "팔라티노 언덕 레스토랑", description: "로마 야경 보며 이탈리아 저녁 식사" },
          ],
        },
        {
          title: "바티칸 & 트레비 분수",
          accommodation: "로마 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "바티칸 박물관 & 시스티나 성당", description: "미켈란젤로의 천장화 감상" },
            { time: "14:00", place: "트레비 분수", description: "소원의 분수에 동전 던지기 체험" },
            { time: "19:00", place: "판테온 인근 레스토랑", description: "로마 역사 지구에서 마지막 이탈리아 저녁" },
          ],
        },
        {
          title: "로마 자유 관광",
          accommodation: "로마 특급 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "보르게세 미술관", description: "베르니니 조각과 카라바조 작품 감상" },
            { time: "14:00", place: "스페인 계단", description: "로마 패션 거리 자유 탐방" },
            { time: "19:00", place: "나보나 광장 카페", description: "바로크 광장에서 젤라또와 저녁 식사" },
          ],
        },
        {
          title: "로마 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "피우미치노 공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 60),
            returnDate: addDays(today, 68),
            priceAdult: 3990000,
            priceChild: 2990000,
            capacity: 18,
            bookedSeats: 6,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 90),
            returnDate: addDays(today, 98),
            priceAdult: 3990000,
            priceChild: 2990000,
            capacity: 18,
            bookedSeats: 0,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 6: 스위스 알프스 9박10일 ───────────────────────
  await prisma.product.create({
    data: {
      title: "스위스 알프스 9박10일",
      summary:
        "융프라우요흐, 마터호른, 루체른 등 스위스 최고 절경 코스. 스위스 패스 포함 프리미엄 알프스 여행.",
      aiSummary:
        "융프라우요흐, 마터호른, 루체른 등 스위스 최고의 절경을 모두 담은 프리미엄 일정입니다.\n스위스 패스로 자유롭게 이동하며 산악 열차와 케이블카를 무제한 탑승합니다.\n4성급 이상 호텔과 퐁뒤·라클렛 만찬이 포함된 미식 여행이기도 합니다.",
      destination: "스위스",
      destinationCode: "EU-CH",
      durationNights: 9,
      durationDays: 10,
      heroImageUrl: "https://picsum.photos/seed/swiss-alps/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 4990000,
      tags: { create: [{ tag: "#알프스" }, { tag: "#프리미엄" }, { tag: "#설경" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 취리히 도착",
          accommodation: "취리히 호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "16:00", place: "취리히 공항", description: "입국 수속 후 취리히 시내 이동" },
            { time: "19:00", place: "취리히 구시가 레스토랑", description: "스위스 전통 뢰슈티로 저녁 식사" },
          ],
        },
        {
          title: "취리히 & 루체른",
          accommodation: "루체른 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "취리히 구시가", description: "반호프슈트라세와 그로스뮌스터 관람" },
            { time: "14:00", place: "루체른 카펠교", description: "유럽에서 가장 오래된 목조 다리 탐방" },
            { time: "19:00", place: "루체른 호숫가 레스토랑", description: "루체른 호수 야경과 함께 퐁뒤 저녁" },
          ],
        },
        {
          title: "필라투스 산악 열차",
          accommodation: "루체른 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "알프나흐슈타트역", description: "세계 최급경사 산악 열차로 필라투스 정상 등정" },
            { time: "14:00", place: "필라투스 쿨름 전망대", description: "알프스 파노라마 360도 감상" },
            { time: "19:00", place: "루체른 퐁뒤 레스토랑", description: "치즈 퐁뒤와 라클렛 저녁 만찬" },
          ],
        },
        {
          title: "인터라켄 이동",
          accommodation: "인터라켄 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "루체른역", description: "스위스 패스로 인터라켄 이동" },
            { time: "14:00", place: "툰 호수", description: "유람선으로 툰 호수 유람" },
            { time: "19:00", place: "인터라켄 레스토랑", description: "인터라켄 도착 후 스위스 전통 저녁" },
          ],
        },
        {
          title: "융프라우요흐",
          accommodation: "인터라켄 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "그린델발트 터미널", description: "융프라우 산악 열차 탑승 출발" },
            { time: "14:00", place: "융프라우요흐 정상 (3,454m)", description: "알레치 빙하와 만년설 파노라마 감상" },
            { time: "19:00", place: "인터라켄 레스토랑", description: "융프라우 정복 기념 특별 저녁 식사" },
          ],
        },
        {
          title: "체르마트 이동",
          accommodation: "체르마트 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인터라켄역", description: "스위스 패스로 체르마트 이동" },
            { time: "14:00", place: "체르마트 마을", description: "차 없는 산악 마을 도보 탐방" },
            { time: "19:00", place: "체르마트 레스토랑", description: "마터호른 뷰 레스토랑에서 라클렛 저녁" },
          ],
        },
        {
          title: "마터호른 고르너그라트",
          accommodation: "체르마트 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "고르너그라트 전망대 (3,089m)", description: "마터호른 정면 뷰와 알프스 파노라마 감상" },
            { time: "14:00", place: "체르마트 빙하 공원", description: "빙하 지형과 산악 박물관 탐방" },
            { time: "19:00", place: "체르마트 이탈리안 레스토랑", description: "이탈리아 접경 체르마트 특색 요리 저녁" },
          ],
        },
        {
          title: "제네바 이동 & 관광",
          accommodation: "제네바 4성 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "체르마트역", description: "스위스 패스로 제네바 이동" },
            { time: "14:00", place: "제네바 레만 호수", description: "제트도 분수와 레만 호수 산책" },
            { time: "19:00", place: "제네바 레스토랑", description: "프랑스어권 스위스 요리 저녁 식사" },
          ],
        },
        {
          title: "제네바 자유 & 공항 이동",
          accommodation: "공항 근처 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "국제 연합 제네바 사무소", description: "UN 유럽 본부 및 평화 광장 탐방" },
            { time: "14:00", place: "파텍 필립 박물관", description: "세계 최고 시계 브랜드 박물관 관람" },
            { time: "19:00", place: "공항 인근 레스토랑", description: "마지막 스위스 저녁 식사" },
          ],
        },
        {
          title: "제네바 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "제네바 공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 60),
            returnDate: addDays(today, 69),
            priceAdult: 4990000,
            priceChild: 3990000,
            capacity: 14,
            bookedSeats: 4,
            minPax: 8,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 90),
            returnDate: addDays(today, 99),
            priceAdult: 4990000,
            priceChild: 3990000,
            capacity: 14,
            bookedSeats: 0,
            minPax: 8,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 7: 발리 가성비 4박6일 (마감임박 검증용) ────────
  await prisma.product.create({
    data: {
      title: "발리 가성비 4박6일",
      summary:
        "합리적인 가격으로 발리 핵심을 모두 즐기는 가성비 패키지. 우붓, 따나롯, 꾸따 해변이 모두 포함.",
      aiSummary:
        "합리적인 가격으로 발리의 핵심을 모두 즐기는 가성비 패키지입니다.\n우붓 원숭이 숲, 따나롯 사원, 꾸따 해변이 모두 포함된 알찬 일정입니다.\n3성급 리조트와 조식 포함으로 편안한 휴가를 보장합니다.",
      destination: "발리, 인도네시아",
      destinationCode: "ID-DPS",
      durationNights: 4,
      durationDays: 6,
      heroImageUrl: "https://picsum.photos/seed/bali-budget/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 990000,
      tags: { create: [{ tag: "#가성비" }, { tag: "#휴양" }, { tag: "#리조트" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 발리 도착",
          accommodation: "리조트 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "16:00", place: "응우라 라이 공항", description: "입국 수속 후 리조트 이동" },
            { time: "19:00", place: "꾸따 비치 레스토랑", description: "발리 도착 기념 인도네시아 요리 저녁" },
          ],
        },
        {
          title: "우붓 원숭이 숲 & 논밭",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "우붓 원숭이 숲", description: "열대우림 속 원숭이 서식지 탐방" },
            { time: "14:00", place: "떼갈랄랑 계단식 논", description: "인스타그램 명소 우붓 계단식 논 감상" },
            { time: "19:00", place: "우붓 왕궁 인근 레스토랑", description: "발리 전통 공연 감상하며 저녁 식사" },
          ],
        },
        {
          title: "따나롯 사원 & 꾸따 해변",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "따나롯 사원", description: "바다 위에 떠있는 발리 대표 사원 일몰 감상" },
            { time: "14:00", place: "꾸따 해변", description: "서핑 메카 꾸따 해변에서 자유 시간" },
            { time: "19:00", place: "스미냑 레스토랑", description: "발리 힙스터 구역 스미냑 저녁 식사" },
          ],
        },
        {
          title: "스파 & 리조트 자유 시간",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "리조트 수영장", description: "리조트 풀에서 여유로운 오전 시간" },
            { time: "14:00", place: "발리 스파", description: "바디 스크럽과 발리 마사지 체험" },
            { time: "19:00", place: "짐바란 시푸드", description: "해변가 BBQ 씨푸드 저녁 식사" },
          ],
        },
        {
          title: "발리 관광 / 공항 이동",
          accommodation: "공항 인근 호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "울루와뚜 사원", description: "발리 최남단 절벽 위 사원 관람" },
            { time: "14:00", place: "가루다 위스누 켄차나", description: "발리 최대 문화 공원 탐방" },
            { time: "19:00", place: "공항 인근 레스토랑", description: "마지막 발리 요리로 저녁 식사" },
          ],
        },
        {
          title: "발리 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "응우라 라이 공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            departureDate: addDays(today, 14),
            returnDate: addDays(today, 19),
            priceAdult: 990000,
            priceChild: 790000,
            capacity: 20,
            bookedSeats: 18,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
          {
            departureDate: addDays(today, 45),
            returnDate: addDays(today, 50),
            priceAdult: 990000,
            priceChild: 790000,
            capacity: 20,
            bookedSeats: 5,
            minPax: 10,
            status: DepartureStatus.SCHEDULED,
          },
        ],
      },
    },
  });

  // ─── Product 8: 세부 가족여행 4박5일 (Departure 없음 — 폴백 검증) ─
  await prisma.product.create({
    data: {
      title: "세부 가족여행 4박5일",
      summary:
        "세부 스노클링, 고래상어 투어, 투말록 폭포 트레킹까지. 가족 모두가 즐기는 해양 액티비티 패키지.",
      aiSummary:
        "세부 오스메냐 서클부터 막탄 섬 스노클링까지 가족 모두가 즐기는 패키지입니다.\n고래상어 투어와 투말록 폭포 트레킹이 아이들의 모험심을 자극합니다.\n리조트 내 키즈 클럽과 해양스포츠 프로그램이 충실하게 준비돼 있습니다.",
      destination: "세부, 필리핀",
      destinationCode: "PH-CEB",
      durationNights: 4,
      durationDays: 5,
      heroImageUrl: "https://picsum.photos/seed/cebu-family/800/500",
      status: ProductStatus.PUBLISHED,
      basePriceAdult: 1390000,
      tags: { create: [{ tag: "#가족" }, { tag: "#해양스포츠" }, { tag: "#스노클링" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 세부 도착",
          accommodation: "리조트 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "15:00", place: "막탄 세부 국제공항", description: "입국 수속 후 리조트 이동" },
            { time: "19:00", place: "리조트 레스토랑", description: "웰컴 씨푸드 뷔페 저녁 식사" },
          ],
        },
        {
          title: "고래상어 투어 (오슬롭)",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "오슬롭 고래상어 포인트", description: "세계 최대 어류 고래상어 스노클링 체험" },
            { time: "14:00", place: "투말록 폭포", description: "필리핀 최고의 폭포 트레킹 및 수영" },
            { time: "19:00", place: "세부 해산물 레스토랑", description: "신선한 세부 해산물 저녁 식사" },
          ],
        },
        {
          title: "막탄 섬 스노클링",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "막탄 섬 해양 공원", description: "형형색색 산호초 스노클링 체험" },
            { time: "14:00", place: "마젤란 십자가", description: "세부 역사 유적지 관람" },
            { time: "19:00", place: "IT 파크 레스토랑", description: "세부 최신 다이닝 거리에서 저녁 식사" },
          ],
        },
        {
          title: "리조트 자유 & 키즈 클럽",
          accommodation: "리조트",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "리조트 키즈 클럽", description: "아이들을 위한 다양한 해양 프로그램 체험" },
            { time: "14:00", place: "리조트 수영장", description: "가족과 함께 리조트 수영장 자유 시간" },
            { time: "19:00", place: "리조트 비치 바비큐", description: "해변 바비큐 패밀리 저녁 파티" },
          ],
        },
        {
          title: "세부 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "리조트 로비", description: "체크아웃 및 공항 이동" },
            { time: "14:00", place: "막탄 세부 국제공항", description: "탑승 수속 및 귀국 출발" },
            { time: "19:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      // departures: 없음 — lowestPrice null → basePriceAdult 폴백 검증
    },
  });

  // ─── Product 9: 후쿠오카 미식 3박4일 (CLOSED + 과거/CANCELED Departure) ─
  await prisma.product.create({
    data: {
      title: "후쿠오카 미식 3박4일",
      summary:
        "하카타 라멘, 모쓰나베, 멘타이코 중심의 미식 여행. 야타이 포장마차 투어와 나카스 시장 새벽 경매 포함.",
      aiSummary:
        "하카타 라멘, 모쓰나베, 멘타이코 등 후쿠오카 현지 미식을 중심으로 한 여행입니다.\n야타이 포장마차 투어와 나카스 시장 새벽 경매 견학이 하이라이트입니다.\n소규모 그룹으로 진행해 현지인처럼 깊이 있는 식문화를 체험합니다.",
      destination: "후쿠오카, 일본",
      destinationCode: "JP-FUK",
      durationNights: 3,
      durationDays: 4,
      heroImageUrl: "https://picsum.photos/seed/fukuoka-food/800/500",
      status: ProductStatus.CLOSED,
      basePriceAdult: 1090000,
      tags: { create: [{ tag: "#미식" }, { tag: "#라멘" }, { tag: "#하카타" }] },
      inclusions: makeInclusions(),
      itineraryDays: makeDays([
        {
          title: "인천 출발 / 후쿠오카 도착",
          accommodation: "호텔 체크인",
          meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
            { time: "12:00", place: "후쿠오카 공항", description: "입국 수속 후 시내 이동" },
            { time: "19:00", place: "나카스 야타이", description: "후쿠오카 포장마차 거리에서 하카타 라멘" },
          ],
        },
        {
          title: "후쿠오카 미식 투어",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "나카스 시장", description: "새벽 시장 경매 견학 및 신선 식재료 탐방" },
            { time: "14:00", place: "다자이후 텐만구", description: "학문의 신 모시는 전통 신사 관람" },
            { time: "19:00", place: "하카타 모쓰나베 전문점", description: "후쿠오카 명물 곱창 전골 저녁 식사" },
          ],
        },
        {
          title: "멘타이코 공장 & 캐널 시티",
          accommodation: "호텔",
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "현지식" },
          stops: [
            { time: "09:00", place: "후쿠야 멘타이코 공장", description: "후쿠오카 명물 명란젓 제조 공정 견학" },
            { time: "14:00", place: "캐널 시티 하카타", description: "복합 쇼핑몰 자유 탐방" },
            { time: "19:00", place: "텐진 선술집 거리", description: "텐진 야키토리와 전통 소주로 마지막 저녁" },
          ],
        },
        {
          title: "후쿠오카 출발 / 인천 도착",
          accommodation: null,
          meals: { breakfast: "호텔", lunch: "현지식", dinner: "기내식" },
          stops: [
            { time: "09:00", place: "호텔 로비", description: "체크아웃 및 공항 이동" },
            { time: "13:00", place: "후쿠오카 공항", description: "탑승 수속 및 귀국 출발" },
            { time: "18:00", place: "인천국제공항", description: "입국 수속 후 귀가" },
          ],
        },
      ]),
      departures: {
        create: [
          {
            // 과거 출발일 (-30d) — 미래 필터 제외 검증
            departureDate: addDays(today, -30),
            returnDate: addDays(today, -27),
            priceAdult: 1090000,
            priceChild: 890000,
            capacity: 16,
            bookedSeats: 10,
            minPax: 8,
            status: DepartureStatus.SCHEDULED,
          },
          {
            // CANCELED — 필터 제외 검증
            departureDate: addDays(today, 30),
            returnDate: addDays(today, 33),
            priceAdult: 1090000,
            priceChild: 890000,
            capacity: 16,
            bookedSeats: 0,
            minPax: 8,
            status: DepartureStatus.CANCELED,
          },
        ],
      },
    },
  });

  // ─── Product 10: 보라카이 5박6일 (DRAFT, 작성중) ────────────
  await prisma.product.create({
    data: {
      title: "보라카이 5박6일 (작성중)",
      summary: "보라카이 화이트비치에서 즐기는 휴양 여행. (현재 작성 중인 상품입니다)",
      aiSummary: null,
      destination: "보라카이, 필리핀",
      destinationCode: "PH-MNL",
      durationNights: 5,
      durationDays: 6,
      heroImageUrl: "https://picsum.photos/seed/boracay-draft/800/500",
      status: ProductStatus.DRAFT,
      basePriceAdult: 1690000,
      tags: { create: [{ tag: "#휴양" }, { tag: "#화이트비치" }] },
      inclusions: {
        create: [
          { kind: InclusionKind.INCLUDED, label: "왕복 항공권" },
          { kind: InclusionKind.INCLUDED, label: "전 일정 호텔 숙박" },
          { kind: InclusionKind.EXCLUDED, label: "개인 여행자 보험" },
        ],
      },
      itineraryDays: {
        create: [
          {
            dayNumber: 1,
            title: "인천 출발 / 보라카이 도착",
            accommodation: "호텔 체크인",
            meals: { breakfast: "기내식", lunch: "기내식", dinner: "현지식" },
            stops: {
              create: [
                { order: 1, time: "09:00", place: "인천국제공항", description: "탑승 수속 및 출국" },
                { order: 2, time: "15:00", place: "칼리보 공항", description: "입국 수속 후 보라카이 이동" },
                { order: 3, time: "19:00", place: "화이트비치 레스토랑", description: "보라카이 도착 기념 저녁 식사" },
              ],
            },
          },
        ],
      },
      // departures: 없음 (DRAFT)
    },
  });

  console.log("✅ Seed complete: 10 products created");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
