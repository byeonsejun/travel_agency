import { describe, it, expect } from "vitest";
import { buildEmbeddingText } from "../buildEmbeddingText";
import type { ProductDetail } from "../../model/types";

// ──────────────────────────────────────────────
// 테스트 픽스처 헬퍼
// ──────────────────────────────────────────────

const BASE_PRODUCT: ProductDetail = {
  id: "prod-1",
  title: "오사카 3박 4일 패키지",
  summary: "가성비 넘치는 오사카 완전정복 코스",
  destination: "JP-OSA",
  destinationCode: "JP-OSA",
  durationNights: 3,
  durationDays: 4,
  heroImageUrl: "https://example.com/hero.jpg",
  basePriceAdult: 890000,
  penaltyPolicyKey: null,
  aiSummary: null,
  status: "PUBLISHED",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
  tags: [
    { id: "t1", productId: "prod-1", tag: "가족여행" },
    { id: "t2", productId: "prod-1", tag: "미식" },
    { id: "t3", productId: "prod-1", tag: "쇼핑" },
  ],
  inclusions: [
    {
      id: "inc-1",
      productId: "prod-1",
      kind: "INCLUDED",
      label: "왕복항공권",
      note: "인천-오사카 직항",
    },
    {
      id: "inc-2",
      productId: "prod-1",
      kind: "EXCLUDED",
      label: "여행자보험",
      note: "개인 준비 필요",
    },
  ],
  itineraryDays: [
    {
      id: "day-1",
      productId: "prod-1",
      dayNumber: 1,
      title: "인천 출발 → 오사카 도착",
      accommodation: "오사카 시내 호텔",
      meals: {},
      stops: [
        {
          id: "s1",
          itineraryDayId: "day-1",
          order: 1,
          time: "09:00",
          place: "인천국제공항",
          description: "공항 집결 및 탑승 수속",
        },
        {
          id: "s2",
          itineraryDayId: "day-1",
          order: 2,
          time: "13:00",
          place: "간사이국제공항",
          description: "입국 심사 후 호텔 이동",
        },
      ],
    },
    {
      id: "day-2",
      productId: "prod-1",
      dayNumber: 2,
      title: "오사카 시내 관광",
      accommodation: "오사카 시내 호텔",
      meals: {},
      stops: [
        {
          id: "s3",
          itineraryDayId: "day-2",
          order: 1,
          time: "09:00",
          place: "오사카성",
          description: "오사카성 천수각 관람 및 공원 산책",
        },
        {
          id: "s4",
          itineraryDayId: "day-2",
          order: 2,
          time: "14:00",
          place: "도톤보리",
          description: "현지 음식 체험 및 야경 감상",
        },
      ],
    },
  ],
};

// ──────────────────────────────────────────────
// 테스트 스위트
// ──────────────────────────────────────────────

describe("buildEmbeddingText", () => {
  // ── 1. 반환 타입 확인 ──
  it("returns { text, contentHash } shape", () => {
    const result = buildEmbeddingText(BASE_PRODUCT);
    expect(result).toHaveProperty("text");
    expect(result).toHaveProperty("contentHash");
    expect(typeof result.text).toBe("string");
    expect(typeof result.contentHash).toBe("string");
  });

  // ── 2. Happy path — 텍스트 구성 ──
  describe("happy path — text composition", () => {
    it("includes title, summary, destination", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      expect(text).toContain("오사카 3박 4일 패키지");
      expect(text).toContain("가성비 넘치는 오사카 완전정복 코스");
      expect(text).toContain("JP-OSA");
    });

    it("includes all 3 tag strings", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      expect(text).toContain("가족여행");
      expect(text).toContain("미식");
      expect(text).toContain("쇼핑");
    });

    it("includes INCLUDED inclusion label and note", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      expect(text).toContain("왕복항공권");
      expect(text).toContain("인천-오사카 직항");
    });

    it("does NOT include EXCLUDED inclusion content", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      // EXCLUDED는 검색 anti-signal이므로 포함 금지
      expect(text).not.toContain("여행자보험");
      expect(text).not.toContain("개인 준비 필요");
    });

    it("includes every ItineraryStop description", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      expect(text).toContain("공항 집결 및 탑승 수속");
      expect(text).toContain("입국 심사 후 호텔 이동");
      expect(text).toContain("오사카성 천수각 관람 및 공원 산책");
      expect(text).toContain("현지 음식 체험 및 야경 감상");
    });

    it("includes every ItineraryStop place (proper noun signal)", () => {
      const { text } = buildEmbeddingText(BASE_PRODUCT);
      expect(text).toContain("인천국제공항");
      expect(text).toContain("간사이국제공항");
      expect(text).toContain("오사카성");
      expect(text).toContain("도톤보리");
    });
  });

  // ── 3. 빈 필드 견고성 ──
  describe("empty-field robustness", () => {
    it("returns valid result with zero tags", () => {
      const product: ProductDetail = { ...BASE_PRODUCT, tags: [] };
      expect(() => buildEmbeddingText(product)).not.toThrow();
      const { text, contentHash } = buildEmbeddingText(product);
      expect(text.length).toBeGreaterThan(0);
      expect(contentHash.length).toBe(64); // SHA-256 hex = 64 chars
    });

    it("returns valid result with zero inclusions", () => {
      const product: ProductDetail = { ...BASE_PRODUCT, inclusions: [] };
      expect(() => buildEmbeddingText(product)).not.toThrow();
      const { contentHash } = buildEmbeddingText(product);
      expect(contentHash.length).toBe(64);
    });

    it("returns valid result with zero itinerary days", () => {
      const product: ProductDetail = { ...BASE_PRODUCT, itineraryDays: [] };
      expect(() => buildEmbeddingText(product)).not.toThrow();
      const { contentHash } = buildEmbeddingText(product);
      expect(contentHash.length).toBe(64);
    });

    it("returns valid result with all collections empty", () => {
      const product: ProductDetail = {
        ...BASE_PRODUCT,
        tags: [],
        inclusions: [],
        itineraryDays: [],
      };
      expect(() => buildEmbeddingText(product)).not.toThrow();
      const { text, contentHash } = buildEmbeddingText(product);
      expect(text).toContain("오사카 3박 4일 패키지");
      expect(contentHash.length).toBe(64);
    });
  });

  // ── 4. 결정론 — 동일 입력 → 동일 hash ──
  describe("determinism", () => {
    it("same input produces same hash on repeated calls", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText(BASE_PRODUCT);
      expect(r1.contentHash).toBe(r2.contentHash);
      expect(r1.text).toBe(r2.text);
    });

    // ── 5. 태그 순서 무감각 ──
    it("tag array order does not affect hash", () => {
      const orderedTags = [
        { id: "t1", productId: "prod-1", tag: "가족여행" },
        { id: "t2", productId: "prod-1", tag: "미식" },
        { id: "t3", productId: "prod-1", tag: "쇼핑" },
      ];
      const reversedTags = [...orderedTags].reverse();

      const r1 = buildEmbeddingText({ ...BASE_PRODUCT, tags: orderedTags });
      const r2 = buildEmbeddingText({ ...BASE_PRODUCT, tags: reversedTags });
      expect(r1.contentHash).toBe(r2.contentHash);
      expect(r1.text).toBe(r2.text);
    });

    // ── 6. Inclusion 순서 무감각 ──
    it("inclusion array order does not affect hash", () => {
      const inc1 = BASE_PRODUCT.inclusions[0];
      const inc2 = BASE_PRODUCT.inclusions[1];
      // inc2는 EXCLUDED라서 텍스트에 포함 안 되지만, 순서 정렬 코드는 실행됨
      const r1 = buildEmbeddingText({
        ...BASE_PRODUCT,
        inclusions: [inc1, inc2],
      });
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        inclusions: [inc2, inc1],
      });
      expect(r1.contentHash).toBe(r2.contentHash);
    });

    // ── 7. ItineraryDay 순서 무감각 ──
    it("itinerary day order does not affect hash (sort by dayNumber)", () => {
      const days = BASE_PRODUCT.itineraryDays;
      const reversed = [...days].reverse(); // dayNumber 2, 1 순서

      const r1 = buildEmbeddingText({ ...BASE_PRODUCT, itineraryDays: days });
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        itineraryDays: reversed,
      });
      expect(r1.contentHash).toBe(r2.contentHash);
      expect(r1.text).toBe(r2.text);
    });

    // ── 8. Stop 순서 무감각 (동일 day 내) ──
    it("stop order within a day does not affect hash (sort by order field)", () => {
      const day1 = BASE_PRODUCT.itineraryDays[0];
      const reversedStops = [...day1.stops].reverse(); // order 2, 1

      const modifiedDays = [
        { ...day1, stops: reversedStops },
        BASE_PRODUCT.itineraryDays[1],
      ];

      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        itineraryDays: modifiedDays,
      });
      expect(r1.contentHash).toBe(r2.contentHash);
      expect(r1.text).toBe(r2.text);
    });
  });

  // ── 9. 민감도 — 필드 하나 변경 → hash 변동 ──
  describe("sensitivity — one field change changes hash", () => {
    it("title change → different hash", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        title: "오사카 3박 4일 패키지X",
      });
      expect(r1.contentHash).not.toBe(r2.contentHash);
    });

    it("destination change → different hash", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({ ...BASE_PRODUCT, destination: "KR-SEO" });
      expect(r1.contentHash).not.toBe(r2.contentHash);
    });

    it("summary change → different hash", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        summary: "완전히 다른 요약 문구로 교체",
      });
      expect(r1.contentHash).not.toBe(r2.contentHash);
    });

    it("stop description change → different hash", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const modifiedDays = BASE_PRODUCT.itineraryDays.map((day) =>
        day.dayNumber === 1
          ? {
              ...day,
              stops: day.stops.map((s) =>
                s.order === 1
                  ? { ...s, description: "변경된 설명 텍스트" }
                  : s
              ),
            }
          : day
      );
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        itineraryDays: modifiedDays,
      });
      expect(r1.contentHash).not.toBe(r2.contentHash);
    });
  });

  // ── 10. 공백 정규화 ──
  describe("whitespace normalization", () => {
    it("leading/trailing whitespace in fields does not change hash", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        title: "  오사카 3박 4일 패키지  ",
        summary: "\n가성비 넘치는 오사카 완전정복 코스\n",
        destination: " JP-OSA ",
      });
      expect(r1.contentHash).toBe(r2.contentHash);
    });

    it("internal whitespace collapse — multiple spaces treated same as single", () => {
      const r1 = buildEmbeddingText(BASE_PRODUCT);
      const r2 = buildEmbeddingText({
        ...BASE_PRODUCT,
        title: "오사카  3박  4일  패키지", // double spaces internally
      });
      // 내부 공백 정규화 시 동일 hash; 정규화 안 하면 다를 것임
      expect(r1.contentHash).toBe(r2.contentHash);
    });
  });

  // ── 11. contentHash 형식 검증 ──
  it("contentHash is lowercase SHA-256 hex (64 chars)", () => {
    const { contentHash } = buildEmbeddingText(BASE_PRODUCT);
    expect(contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
