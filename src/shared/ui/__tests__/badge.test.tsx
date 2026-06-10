import { describe, it, expect, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { Badge } from "../badge";

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

function classOf(node: React.ReactElement): string {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(node));
  return (container.firstElementChild as HTMLElement).className;
}

describe("<Badge /> semantic tones", () => {
  it("success tone 은 green 의미색을 적용한다 (대비 위해 text-800)", () => {
    const cls = classOf(<Badge variant="success">완료</Badge>);
    expect(cls).toContain("bg-green-100");
    expect(cls).toContain("text-green-800");
  });
  it("warning tone 은 yellow 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="warning">대기</Badge>)).toContain("bg-yellow-100");
  });
  it("info tone 은 blue 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="info">처리 중</Badge>)).toContain("bg-blue-100");
  });
  it("neutral tone 은 gray 의미색을 적용한다", () => {
    expect(classOf(<Badge variant="neutral">보관</Badge>)).toContain("bg-gray-100");
  });
  it("기존 default variant(primary 토큰)은 보존된다", () => {
    expect(classOf(<Badge>기본</Badge>)).toContain("bg-primary");
  });
});
