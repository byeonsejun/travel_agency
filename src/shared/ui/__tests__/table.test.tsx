import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "../table";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("<Table />", () => {
  it("토큰 기반 클래스로 table 구조를 렌더하고 className 을 병합한다", () => {
    const container = document.createElement("div");
    root = createRoot(container);
    act(() => {
      root!.render(
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>상품명</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="text-right">값</TableCell>
            </TableRow>
          </TableBody>
        </Table>,
      );
    });
    const table = container.querySelector("table") as HTMLElement;
    expect(table).not.toBeNull();
    expect(table.className).toContain("w-full");
    const thead = container.querySelector("thead") as HTMLElement;
    expect(thead.className).toContain("bg-muted");
    const row = container.querySelector("tbody tr") as HTMLElement;
    expect(row.className).toContain("border-border");
    const cell = container.querySelector("tbody td") as HTMLElement;
    expect(cell.className).toContain("text-right");
  });
});
