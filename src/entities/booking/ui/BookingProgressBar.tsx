import type { BookingStatus } from "@prisma/client";
import { getBookingProgress } from "../model/progress";

type Props = {
  status: BookingStatus;
  className?: string;
};

/**
 * PRD §4.1D — 예약 진행 상태 바.
 * 가로형 점 연결 (Connected dots with lines) 레이아웃.
 * 취소(CANCELED_BY_*) 상태는 진행 흐름과 분리해 별도 배너로 대체한다.
 */
export function BookingProgressBar({ status, className }: Props) {
  const progress = getBookingProgress(status);

  if (progress.canceled) {
    return (
      <div
        role="status"
        className={`rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 ${className ?? ""}`}
      >
        <span className="font-semibold">예약 취소됨</span>
        <span className="ml-1 text-red-600/80">
          ({progress.canceledBy === "user" ? "고객 취소" : "여행사 취소"})
        </span>
      </div>
    );
  }

  return (
    <ol
      role="list"
      aria-label="예약 진행 단계"
      className={`flex w-full items-start ${className ?? ""}`}
    >
      {progress.steps.map((step, i) => {
        const isLast = i === progress.steps.length - 1;
        const isDone = step.state === "done";
        const isCurrent = step.state === "current";

        // 다음 스텝으로 가는 연결선 색상 — 현재까지 done이면 파랑, 그 외 회색
        const lineColor = isDone ? "bg-blue-600" : "bg-gray-200";

        // 원(circle) 시각 토큰
        const circleBase =
          "relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold transition-colors";
        const circleColor = isDone
          ? "bg-blue-600 text-white"
          : isCurrent
            ? "bg-blue-600 text-white ring-4 ring-blue-200"
            : "bg-gray-200 text-gray-400";

        const labelColor = isDone
          ? "text-blue-700"
          : isCurrent
            ? "text-blue-700 font-semibold"
            : "text-gray-400";

        return (
          <li
            key={step.key}
            aria-current={isCurrent ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center"
          >
            {/* 원 + 다음 연결선을 한 row 로 묶음 */}
            <div className="flex w-full items-center">
              {/* 왼쪽 선: 첫 스텝은 visibility hidden 으로 자리만 차지 */}
              <span
                aria-hidden="true"
                className={`h-0.5 flex-1 ${i === 0 ? "invisible" : isDone || isCurrent ? "bg-blue-600" : "bg-gray-200"}`}
              />
              <span className={`${circleBase} ${circleColor}`}>
                {isDone ? (
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.704 5.29a1 1 0 0 1 .006 1.414l-7.07 7.13a1 1 0 0 1-1.42 0L4.29 9.9a1 1 0 1 1 1.42-1.41l3.22 3.24 6.36-6.42a1 1 0 0 1 1.414-.018Z"
                      clipRule="evenodd"
                    />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              {/* 오른쪽 선: 마지막 스텝은 visibility hidden */}
              <span
                aria-hidden="true"
                className={`h-0.5 flex-1 ${isLast ? "invisible" : lineColor}`}
              />
            </div>

            {/* 라벨 — 모바일 가독성을 위해 text-[10px], sm 이상 text-xs */}
            <span
              className={`mt-2 block w-full truncate text-center text-[10px] sm:text-xs ${labelColor}`}
              title={step.label}
            >
              {step.label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
