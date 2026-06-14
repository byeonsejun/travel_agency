import type { BookingEvent, BookingStatus } from "@prisma/client";
import { BOOKING_STATUS_LABEL } from "../model/constants";
import { formatEventActor } from "../model/eventActor";

function formatDateTime(date: Date): string {
  return new Date(date).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(state: string | null): string {
  if (!state) return "—";
  return BOOKING_STATUS_LABEL[state as BookingStatus] ?? state;
}

type Props = { events: BookingEvent[] };

export function BookingEventTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">이벤트 이력이 없습니다.</p>;
  }

  // 이벤트는 createdAt asc(과거→현재)로 조회된다 → 마지막 요소가 현재(최신) 상태.
  // 실제 기록된 이벤트만 그린다(해피패스 단계 합성 없음).
  const currentIdx = events.length - 1;

  return (
    <ol className="relative border-l border-border pl-6">
      {events.map((ev, idx) => {
        const isCurrent = idx === currentIdx;
        // reason 은 사람이 입력한 것(고객/관리자 취소 사유 등)만 노출 — 시스템 actor 의
        // 내부 reason(예: "tossPaymentKey=...")은 고객 화면에 부적절하므로 숨긴다.
        const showReason = ev.reason && !ev.actor.startsWith("system:");

        return (
          <li
            key={ev.id}
            className={idx === 0 ? "" : "mt-6"}
            aria-current={isCurrent ? "step" : undefined}
          >
            {/* 타임라인 점 — 현재 상태는 primary 로 채워 강조, 과거는 hollow */}
            <span
              aria-hidden
              className={`absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full ring-2 ${
                isCurrent ? "bg-primary ring-primary" : "bg-card ring-border"
              }`}
            />

            {/* 상태 전이 (한글 라벨) */}
            <p className={`text-sm text-foreground ${isCurrent ? "font-bold" : "font-semibold"}`}>
              {isCurrent && <span className="sr-only">현재 상태, </span>}
              {statusLabel(ev.fromState)} → {statusLabel(ev.toState)}
              {isCurrent && (
                <span className="ml-2 inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 align-middle text-xs font-semibold text-primary">
                  현재
                </span>
              )}
            </p>

            {/* 사유 (사람이 입력한 것만) */}
            {showReason && (
              <p className="mt-0.5 text-sm text-muted-foreground">{ev.reason}</p>
            )}

            {/* 메타: actor + 시각 */}
            <p className="mt-1 text-xs text-muted-foreground">
              {formatEventActor(ev.actor)} · {formatDateTime(ev.createdAt)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
