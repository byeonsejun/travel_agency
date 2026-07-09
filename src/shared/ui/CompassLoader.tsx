/**
 * 나침반 로딩 비주얼 — 순수 프레젠테이션 컴포넌트 (SSOT).
 *
 * 얕은 딤 + 회전 나침반(파비콘과 동일한 컴퍼스 로즈) + 안내 문구를 그린다.
 * **CSS 애니메이션만** 사용하고 브라우저 API·상태·이벤트가 없으므로 `'use client'` 없이
 * server(`loading.tsx`)에서도, client 오버레이(`NavigationLoadingOverlay`) 안에서도 렌더된다.
 *
 * 네비게이션 2단계(라우트 이동 완료 → 콘텐츠 준비까지) 로딩 화면과
 * 1단계(클릭 감지 오버레이)가 **동일한 이 컴포넌트**를 공유해 시각적으로 연속되게 한다.
 *
 * z-index 는 헤더(20)·모달(50) 위, 진행 바(100) 아래(z-[90]) — 두 소비자 동일.
 * reduced-motion 시 회전 정지(`motion-reduce:animate-none`).
 *
 * @param className 루트에 덧붙일 클래스(예: 1단계 오버레이의 진입 페이드 `animate-in fade-in`).
 *   2단계 loading.tsx 는 미지정 → 1단계 hide 와 같은 순간 즉시 표시되어 나침반이 끊기지 않는다.
 */
export function CompassLoader({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="페이지를 불러오는 중입니다"
      className={`fixed inset-0 z-[90] flex items-center justify-center ${className ?? ""}`}
      style={{ backgroundColor: "rgba(15, 22, 38, 0.10)" }}
    >
      {/* 얕은 딤 위에서도 문구가 또렷하도록 옅은 글래스 백킹 */}
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/75 px-8 py-7 shadow-float ring-1 ring-black/5 backdrop-blur-sm">
        {/* 회전 나침반 — 파비콘과 동일한 컴퍼스 로즈. reduced-motion 시 회전 정지. */}
        <div
          className="h-12 w-12 animate-spin motion-reduce:animate-none"
          style={{ animationDuration: "1.6s" }}
          aria-hidden="true"
        >
          <svg viewBox="0 0 64 64" className="h-full w-full">
            {/* 고정 다이얼 링 (회전 불변) */}
            <circle
              cx="32"
              cy="32"
              r="27"
              fill="none"
              stroke="hsl(var(--primary) / 0.16)"
              strokeWidth="3"
            />
            {/* 컴퍼스 로즈 = 회전하는 needle */}
            <path
              d="M32 12 L36 28 L52 32 L36 36 L32 52 L28 36 L12 32 L28 28 Z"
              fill="hsl(var(--primary))"
            />
            {/* 중심점 (회전 불변) */}
            <circle cx="32" cy="32" r="3" fill="hsl(var(--primary))" />
          </svg>
        </div>
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground">
            잠시만 기다려주세요
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            페이지를 불러오는 중입니다
          </p>
        </div>
      </div>
    </div>
  );
}
