import { describe, it, expect } from "vitest";
import {
  tagProductDetail,
  TAG_DESTINATIONS_LIST,
  TAG_PRODUCTS_LIST,
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
});
