/** 정수(원) → "₩48,230,000" / 음수는 "-₩1,500". */
export function formatKRW(won: number): string {
  const sign = won < 0 ? "-" : "";
  return `${sign}₩${Math.abs(won).toLocaleString("ko-KR")}`;
}

/** 비율(0~1) → "8.7%" (소수 1자리). */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
