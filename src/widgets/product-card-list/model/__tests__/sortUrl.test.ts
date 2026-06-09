import { describe, it, expect } from "vitest";
import { nextSortUrl } from "../sortUrl";

describe("nextSortUrl", () => {
  it("정렬 변경 시 page 를 버리고 destination 을 보존한 채 URL 을 만든다", () => {
    const params = new URLSearchParams("destination=JP&page=3&sort=latest");
    const url = nextSortUrl(params, "price_asc");
    expect(url).toContain("sort=price_asc");
    expect(url).toContain("destination=JP");
    expect(url).not.toContain("page=");
  });

  it("기존 sort 가 없어도 새 값으로 설정한다", () => {
    const url = nextSortUrl(new URLSearchParams(""), "departure_soon");
    expect(url).toBe("/products?sort=departure_soon");
  });
});
