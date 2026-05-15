import type { BookingEvent, BookingStatus } from "@prisma/client";
import { BOOKING_STATUS_LABEL } from "../model/constants";

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
    return <p className="text-sm text-gray-500">이벤트 이력이 없습니다.</p>;
  }

  return (
    <ol className="relative border-l border-gray-200 pl-6">
      {events.map((ev, idx) => (
        <li key={ev.id} className={idx === 0 ? "" : "mt-6"}>
          {/* 타임라인 점 */}
          <span className="absolute -left-[9px] flex h-4 w-4 items-center justify-center rounded-full bg-white ring-2 ring-indigo-500" />

          {/* 상태 전이 */}
          <p className="text-sm font-semibold text-gray-900">
            {statusLabel(ev.fromState)} → {statusLabel(ev.toState)}
          </p>

          {/* 사유 */}
          {ev.reason && (
            <p className="mt-0.5 text-sm text-gray-600">{ev.reason}</p>
          )}

          {/* 메타: actor + 시각 */}
          <p className="mt-1 text-xs text-gray-400">
            {ev.actor} · {formatDateTime(ev.createdAt)}
          </p>
        </li>
      ))}
    </ol>
  );
}
