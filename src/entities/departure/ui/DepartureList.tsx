import type { DepartureSummary } from "../model/types";
import { DEPARTURE_BADGE_THRESHOLD } from "../model/constants";
import { EmptyState } from "@/shared/ui/EmptyState";

type DepartureListProps = {
  departures: DepartureSummary[];
};

/**
 * 출발일 목록을 월별로 그룹화합니다.
 * @param departures 출발일 배열
 * @returns { "2026년 1월": DepartureSummary[], ... } 형태의 객체
 */
function groupByMonth(
  departures: DepartureSummary[]
): Record<string, DepartureSummary[]> {
  return departures.reduce(
    (acc, dep) => {
      const date = new Date(dep.departureDate);
      const key = `${date.getFullYear()}년 ${date.getMonth() + 1}월`;
      if (!acc[key]) acc[key] = [];
      acc[key].push(dep);
      return acc;
    },
    {} as Record<string, DepartureSummary[]>
  );
}

/**
 * 출발일 상태에 따른 배지 정보를 반환합니다.
 */
function getBadge(
  dep: DepartureSummary
): { label: string; color: string } | null {
  if (dep.status === "CONFIRMED")
    return { label: "출발확정", color: "bg-blue-100 text-blue-800" };
  if (dep.status === "CLOSED" || dep.remainingSeats === 0)
    return { label: "마감", color: "bg-red-100 text-red-800" };
  const almostFullThreshold = Math.ceil(dep.capacity * DEPARTURE_BADGE_THRESHOLD);
  if (dep.remainingSeats <= almostFullThreshold)
    return { label: "마감임박", color: "bg-orange-100 text-orange-800" };
  return null;
}

/**
 * 출발일 추가 상태 텍스트를 반환합니다.
 */
function getSubText(dep: DepartureSummary): string | null {
  if (
    dep.bookedSeats < dep.minPax &&
    dep.status === "SCHEDULED"
  ) {
    return "모객 중 (최소 인원 미달)";
  }
  return null;
}

export function DepartureList({ departures }: DepartureListProps) {
  if (departures.length === 0) {
    return <EmptyState title="현재 모객 중인 출발일이 없습니다." />;
  }

  const groupedDepartures = groupByMonth(departures);
  const monthKeys = Object.keys(groupedDepartures).sort();

  return (
    <div className="space-y-8">
      {monthKeys.map((monthKey) => (
        <div key={monthKey}>
          {/* 월 헤더 */}
          <h3 className="mb-4 font-semibold text-gray-900">{monthKey}</h3>

          {/* 테이블 */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-700">
                    출발일
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    성인가
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    아동가
                  </th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">
                    잔여석
                  </th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    상태
                  </th>
                </tr>
              </thead>
              <tbody>
                {groupedDepartures[monthKey].map((dep) => {
                  const badge = getBadge(dep);
                  const subText = getSubText(dep);
                  const formattedDate = new Date(dep.departureDate).toLocaleDateString("ko-KR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                  });

                  return (
                    <tr
                      key={dep.id}
                      className="border-b border-gray-200 hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-4 py-3 text-gray-900">
                        <div>{formattedDate}</div>
                        {subText && (
                          <div className="text-xs text-gray-500 mt-1">
                            {subText}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {dep.priceAdult.toLocaleString()}원
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {dep.priceChild.toLocaleString()}원
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {dep.remainingSeats}/{dep.capacity}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {badge && (
                          <span
                            className={`inline-block rounded-full px-3 py-1 text-xs font-medium ${badge.color}`}
                          >
                            {badge.label}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
