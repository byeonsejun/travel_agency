import { describe, it, expect } from "vitest";
import { parseProductListParams, type ProductListParams } from "../parseListParams";

describe("parseProductListParams", () => {
  it("should fallback to 'latest' when sort is invalid", () => {
    const result = parseProductListParams({
      sort: "invalid",
      page: "1",
      destination: "JP-OSA",
    });
    expect(result.sort).toBe("latest");
  });

  it("should fallback to page 1 when page is -1", () => {
    const result = parseProductListParams({
      sort: "price_asc",
      page: "-1",
      destination: "JP-OSA",
    });
    expect(result.page).toBe(1);
  });

  it("should fallback to page 1 when page is not a number", () => {
    const result = parseProductListParams({
      sort: "price_asc",
      page: "abc",
      destination: "JP-OSA",
    });
    expect(result.page).toBe(1);
  });

  it("should set destination to undefined when missing", () => {
    const result = parseProductListParams({
      sort: "latest",
      page: "1",
    });
    expect(result.destination).toBeUndefined();
  });

  it("should parse valid input correctly", () => {
    const result = parseProductListParams({
      sort: "price_asc",
      page: "2",
      destination: "JP-OSA",
    });
    expect(result).toEqual({
      sort: "price_asc",
      page: 2,
      destination: "JP-OSA",
    });
  });

  it("should handle departure_soon sort option", () => {
    const result = parseProductListParams({
      sort: "departure_soon",
      page: "1",
      destination: "US-NYC",
    });
    expect(result.sort).toBe("departure_soon");
  });

  it("should fallback to page 1 when page is 0", () => {
    const result = parseProductListParams({
      sort: "latest",
      page: "0",
    });
    expect(result.page).toBe(1);
  });
});
