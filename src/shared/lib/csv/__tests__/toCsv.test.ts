import { describe, it, expect } from "vitest";
import { toCsv, type CsvColumn } from "../toCsv";

interface Row {
  name: string;
  price: number;
  note: string | null;
}

const cols: CsvColumn<Row>[] = [
  { header: "이름", value: (r) => r.name },
  { header: "가격", value: (r) => r.price },
  { header: "비고", value: (r) => r.note },
];

describe("toCsv", () => {
  it("헤더 + 데이터 행을 CRLF 로 직렬화", () => {
    const csv = toCsv([{ name: "A", price: 100, note: "x" }], cols);
    expect(csv).toBe("이름,가격,비고\r\nA,100,x");
  });

  it("쉼표/따옴표/개행 포함 셀을 RFC4180 으로 인용", () => {
    const csv = toCsv(
      [{ name: "a,b", price: 1, note: 'he said "hi"\nbye' }],
      cols
    );
    expect(csv).toBe(
      '이름,가격,비고\r\n"a,b",1,"he said ""hi""\nbye"'
    );
  });

  it("null/undefined 는 빈 문자열", () => {
    const csv = toCsv([{ name: "A", price: 0, note: null }], cols);
    expect(csv).toBe("이름,가격,비고\r\nA,0,");
  });

  it("빈 배열이면 헤더만 반환", () => {
    expect(toCsv([], cols)).toBe("이름,가격,비고");
  });
});
