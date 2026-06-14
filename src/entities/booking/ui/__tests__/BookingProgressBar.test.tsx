import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BookingProgressBar } from "../BookingProgressBar";

/**
 * SSR 렌더 검증 — RSC 환경에서 BookingProgressBar가 올바른 HTML을 생성하는지
 * 정적 마크업 수준에서 자동 증거 수집. 시각적(색상·정렬)은 사용자 검증 영역.
 */

describe("<BookingProgressBar /> SSR 렌더", () => {
  it("RECEIVED → 6개 step <li>, 첫 step에 aria-current=step", () => {
    const html = renderToStaticMarkup(<BookingProgressBar status="RECEIVED" />);
    expect(html).toContain('aria-label="예약 진행 단계"');
    // 6개 step 라벨이 모두 포함되어 있어야 함
    expect(html).toContain("예약 접수");
    expect(html).toContain("출발 대기");
    expect(html).toContain("출발 확정");
    expect(html).toContain("결제 완료");
    expect(html).toContain("여행 준비");
    expect(html).toContain("여행 완료");
    // 첫 step이 현재 단계
    expect(html).toContain('aria-current="step"');
  });

  it("PAID → done 스텝에 체크 SVG, 현재 스텝에 ring 강조(primary 토큰)", () => {
    const html = renderToStaticMarkup(<BookingProgressBar status="PAID" />);
    // 체크 SVG path 일부 (done 표시)
    expect(html).toContain("M16.704 5.29");
    // current step의 ring — 클린 블루 primary 토큰
    expect(html).toContain("ring-4 ring-primary/20");
    // current는 PAID 위치 (step 4 / 1-indexed)
    expect(html).toContain('aria-current="step"');
  });

  it("COMPLETED → aria-current 없음 (모두 done)", () => {
    const html = renderToStaticMarkup(
      <BookingProgressBar status="COMPLETED" />,
    );
    expect(html).not.toContain('aria-current="step"');
    expect(html).not.toContain("ring-4 ring-blue-200");
  });

  it("CANCELED_BY_USER → 진행 바 대신 취소 배너", () => {
    const html = renderToStaticMarkup(
      <BookingProgressBar status="CANCELED_BY_USER" />,
    );
    expect(html).toContain("예약 취소됨");
    expect(html).toContain("고객 취소");
    // 취소 종결 배너는 destructive 토큰 톤(클린 블루 시스템 정합)
    expect(html).toContain("bg-destructive/10");
    // 진행 ol 자체가 없어야 함
    expect(html).not.toContain('aria-label="예약 진행 단계"');
  });

  it("CANCELED_BY_AGENCY → '여행사 취소' 라벨", () => {
    const html = renderToStaticMarkup(
      <BookingProgressBar status="CANCELED_BY_AGENCY" />,
    );
    expect(html).toContain("여행사 취소");
  });

  it("className prop이 root 엘리먼트에 합성됨", () => {
    const html = renderToStaticMarkup(
      <BookingProgressBar status="RECEIVED" className="mt-7 custom-test" />,
    );
    expect(html).toContain("mt-7 custom-test");
  });
});
