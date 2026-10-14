import { describe, expect, it } from "vitest";
import { toGa4ItemInput } from "../analytics";

const card = {
  id: "p1",
  title: "오사카 3박 4일",
  destination: "오사카, 일본",
  basePriceAdult: 890000,
};

describe("toGa4ItemInput (product → GA4 item 입력)", () => {
  it("lowestPrice(실제 출발일가)가 있으면 우선", () => {
    expect(toGa4ItemInput({ ...card, lowestPrice: 790000 })).toEqual({
      productId: "p1",
      title: "오사카 3박 4일",
      destination: "오사카, 일본",
      unitPrice: 790000,
    });
  });

  it("lowestPrice 가 없으면 노출용 시작가(basePriceAdult)", () => {
    expect(toGa4ItemInput(card).unitPrice).toBe(890000);
  });

  it("lowestPrice 가 null 이어도 시작가로 폴백", () => {
    expect(toGa4ItemInput({ ...card, lowestPrice: null }).unitPrice).toBe(890000);
  });
});
