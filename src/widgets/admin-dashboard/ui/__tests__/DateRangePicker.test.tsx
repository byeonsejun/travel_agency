import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangePicker } from "../DateRangePicker";

const push = vi.fn();
let searchParams = new URLSearchParams("productId=p1");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => searchParams,
}));

// 서버 부모가 주입하는 prop(presetRange 사전 계산본) — [ADR-0053] 누출 방지 계약.
const PRESETS_FIXTURE = [
  { key: "today" as const, label: "오늘", start: "2026-05-20", end: "2026-05-20" },
  { key: "7d" as const, label: "7일", start: "2026-05-13", end: "2026-05-20" },
  { key: "30d" as const, label: "30일", start: "2026-04-20", end: "2026-05-20" },
];

describe("DateRangePicker", () => {
  beforeEach(() => {
    push.mockClear();
    searchParams = new URLSearchParams("productId=p1");
  });

  it("적용 시 입력한 start/end 로 push, productId 보존", () => {
    render(
      <DateRangePicker start="2026-05-01" end="2026-05-15" presets={PRESETS_FIXTURE} />,
    );
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

  it("프리셋(7일) 클릭 시 사전계산된 range로 즉시 push", () => {
    render(
      <DateRangePicker start="2026-05-01" end="2026-05-15" presets={PRESETS_FIXTURE} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "7일" }));
    expect(push).toHaveBeenCalledTimes(1);
    const url = push.mock.calls[0][0] as string;
    expect(url).toContain("start=2026-05-13");
    expect(url).toContain("end=2026-05-20");
    expect(url).toContain("productId=p1");
  });
});
