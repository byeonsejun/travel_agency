/** 정수(원) → "₩48,230,000" / 음수는 "-₩1,500". */
export function formatKRW(won: number): string {
  const sign = won < 0 ? "-" : "";
  return `${sign}₩${Math.abs(won).toLocaleString("ko-KR")}`;
}

/** 비율(0~1) → "8.7%" (소수 1자리). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

/**
 * 태그를 표시용으로 정규화 — 선행 '#'(0개 이상)를 정확히 1개로.
 * 태그는 DB에 '#가족'처럼 '#' 포함으로 저장되므로, UI가 별도로 '#'를
 * 덧붙이면 '##가족'이 된다. 이 함수로 항상 단일 '#'를 보장한다.
 * "#가족"/"##가족"/"가족" → "#가족".
 */
export function formatTagLabel(tag: string): string {
  return tag.replace(/^#*/, "#");
}
