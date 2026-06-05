import { describe, it, expect, vi, beforeEach } from "vitest";
import { downloadCsv } from "../downloadCsv";
import type { CsvColumn } from "@/shared/lib/csv/toCsv";

interface Row {
  a: string;
}

const cols: CsvColumn<Row>[] = [{ header: "A", value: (r) => r.a }];

beforeEach(() => {
  vi.restoreAllMocks();
  // jsdom 은 objectURL 미구현 → 스텁.
  globalThis.URL.createObjectURL = vi.fn(() => "blob:mock");
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe("downloadCsv", () => {
  it("objectURL 을 생성하고 누수 방지를 위해 revoke 한다", () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadCsv([{ a: "x" }], cols, "test.csv");
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:mock");
  });
});
