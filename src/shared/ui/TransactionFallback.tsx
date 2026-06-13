// 결제·예약 핵심 트랜잭션 화면의 로딩(스켈레톤) SSOT.
// [ADR-0053] cacheComponents/PPR: 안전 도메인 page는 동적 데이터를 <Suspense>로 격리하고
// 정적 셸 대신 이 fallback이 prerender된다. 민감 데이터(세션/결제/예약)는 절대 셸에 baked되지
// 않으며, 이 골격만 정적 HTML로 나가고 실제 내용은 요청 시점에 스트리밍된다.
//
// variant — 트랜잭션 화면 형태:
//   "form"    : 입력 폼(체크아웃 등) — 좌측 정렬 블록 스택
//   "detail"  : 상세 카드(예약 상세) — 큰 카드 2단
//   "confirm" : 중앙 정렬 확인(결제 confirm/성공·실패 결과) — 원형 + 텍스트 라인

type TransactionFallbackProps = {
  variant?: "form" | "detail" | "confirm";
};

export function TransactionFallback({
  variant = "form",
}: TransactionFallbackProps) {
  if (variant === "confirm") {
    return (
      <div
        className="space-y-4 text-center"
        aria-busy="true"
        aria-live="polite"
        data-testid="transaction-fallback"
        data-variant="confirm"
      >
        <span className="sr-only">불러오는 중…</span>
        <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-muted" />
        <div className="mx-auto h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mx-auto h-4 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (variant === "detail") {
    return (
      <div
        className="space-y-4"
        aria-busy="true"
        aria-live="polite"
        data-testid="transaction-fallback"
        data-variant="detail"
      >
        <span className="sr-only">불러오는 중…</span>
        <div className="h-32 animate-pulse rounded-xl bg-muted" />
        <div className="h-48 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // form (default)
  return (
    <div
      className="space-y-4"
      aria-busy="true"
      aria-live="polite"
      data-testid="transaction-fallback"
      data-variant="form"
    >
      <span className="sr-only">불러오는 중…</span>
      <div className="h-24 animate-pulse rounded-xl bg-muted" />
      <div className="h-40 animate-pulse rounded-xl bg-muted" />
      <div className="h-12 animate-pulse rounded-xl bg-muted" />
    </div>
  );
}
