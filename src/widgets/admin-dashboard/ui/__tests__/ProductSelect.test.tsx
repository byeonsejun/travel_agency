import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProductSelect } from "../ProductSelect";

const push = vi.fn();
let searchParams = new URLSearchParams("start=2026-05-01&end=2026-05-15");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

describe("ProductSelect", () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams("start=2026-05-01&end=2026-05-15");
  });

  it("상품 선택 시 productId 추가하고 start/end 보존", () => {
    render(
      <ProductSelect
        options={[{ id: "p1", title: "도쿄" }]}
        current={null}
      />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p1" } });
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("productId=p1");
    expect(url).toContain("start=2026-05-01");
    expect(url).toContain("end=2026-05-15");
  });

  it("전체(all) 선택 시 productId 제거", () => {
    searchParams = new URLSearchParams("start=2026-05-01&productId=p1");
    render(
      <ProductSelect options={[{ id: "p1", title: "도쿄" }]} current="p1" />
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
    const url = push.mock.calls[0][0] as string;
    expect(url).not.toContain("productId");
    expect(url).toContain("start=2026-05-01");
  });
});
