import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangePicker } from "../DateRangePicker";

const push = vi.fn();
let searchParams = new URLSearchParams("productId=p1");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

describe("DateRangePicker", () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams("productId=p1");
  });

  it("적용 시 입력한 start/end 로 push, productId 보존", () => {
    render(<DateRangePicker start="2026-05-01" end="2026-05-15" />);
    fireEvent.change(screen.getByLabelText("시작일"), {
      target: { value: "2026-04-01" },
    });
    fireEvent.change(screen.getByLabelText("종료일"), {
      target: { value: "2026-04-30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "적용" }));
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("start=2026-04-01");
    expect(url).toContain("end=2026-04-30");
    expect(url).toContain("productId=p1");
  });

  it("프리셋(7일) 클릭 시 즉시 push", () => {
    render(<DateRangePicker start="2026-05-01" end="2026-05-15" />);
    fireEvent.click(screen.getByRole("button", { name: "7일" }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("start=");
    expect(url).toContain("productId=p1");
  });
});
