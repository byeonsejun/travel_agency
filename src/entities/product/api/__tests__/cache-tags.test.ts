import { describe, it, expect } from "vitest";
import {
  tagProductDetail,
  TAG_DESTINATIONS_LIST,
  TAG_PRODUCTS_LIST,
  TAG_PRODUCTS_FEATURED,
} from "../queries";

describe("cache tags — 무효화 컨트랙트", () => {
  it("tagProductDetail(id) 는 id 별 단일 키를 생성한다", () => {
    expect(tagProductDetail("cuid_abc")).toBe("product:cuid_abc");
    expect(tagProductDetail("cuid_xyz")).toBe("product:cuid_xyz");
    expect(tagProductDetail("cuid_abc")).not.toBe(tagProductDetail("cuid_xyz"));
  });

  it("TAG_DESTINATIONS_LIST 는 안정된 단일 문자열이다", () => {
    expect(TAG_DESTINATIONS_LIST).toBe("products:destinations");
  });

  it("TAG_PRODUCTS_LIST 는 안정된 단일 문자열이다", () => {
    expect(TAG_PRODUCTS_LIST).toBe("products:list");
  });

  it("TAG_PRODUCTS_FEATURED 는 안정된 단일 문자열이다", () => {
    expect(TAG_PRODUCTS_FEATURED).toBe("products:featured");
  });

  describe("admin product CRUD 발신처 계약 — ADR-0020 SSOT", () => {
    // createProductAction / updateProductAction / publishProductAction / archiveProductAction
    // 모두 아래 4개 태그를 revalidateTag로 발신해야 한다.
    // 실제 spy 검증은 features/admin-product/server/__tests__/actions.test.ts 에서 수행
    // (FSD 단방향: entities는 features를 import하지 않음).
    it("admin product actions 4종이 발신해야 하는 태그 집합이 완결됨", () => {
      const requiredTags = [
        TAG_PRODUCTS_FEATURED,
        TAG_PRODUCTS_LIST,
        TAG_DESTINATIONS_LIST,
        tagProductDetail("any-product-id"), // 형식 확인 — 실제 id 는 동적
      ];
      expect(requiredTags).toHaveLength(4);
      // 각 태그가 빈 문자열이 아닌 유효한 네임스페이스 형식임을 보장
      requiredTags.forEach((tag) => {
        expect(tag).toMatch(/^product[s]?:/);
      });
    });
  });
});
