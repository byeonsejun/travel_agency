"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  DepartureSummary,
  DepartureLiveSeat,
} from "@/entities/departure";
import { EmptyState } from "@/shared/ui/EmptyState";
import { POLL_INTERVAL_MS, LOW_STOCK_THRESHOLD } from "../model/constants";

type Props = {
  productId: string;
  /** SSR이 그려준 초기값 — 첫 페인트는 폴링 대기 없이 즉시 노출. */
  initialDepartures: DepartureSummary[];
  /**
   * 마감 임박 배지 비율 임계값(DEPARTURE_BADGE_THRESHOLD). 서버 부모가 주입.
   * [ADR-0053] 'use cache'를 품은 @/entities/departure 배럴을 client가 직접 import하면
   * 서버 그래프가 client 번들로 누출돼 빌드가 깨진다 → 순수 상수는 prop으로 전달.
   */
  badgeThreshold: number;
};

type Row = DepartureSummary;

function groupByMonth(rows: Row[]): Record<string, Row[]> {
  return rows.reduce(
    (acc, dep) => {
      const d = new Date(dep.departureDate);
      const key = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      (acc[key] ??= []).push(dep);
      return acc;
    },
    {} as Record<string, Row[]>
  );
}

function getBadge(
  dep: Row,
  badgeThreshold: number
): { label: string; color: string } | null {
  if (dep.status === "CONFIRMED")
    return { label: "출발확정", color: "bg-blue-100 text-blue-800" };
  if (dep.status === "CLOSED" || dep.remainingSeats === 0)
    return { label: "마감", color: "bg-red-100 text-red-800" };
  // 절대 임계값(≤5) 우선. 그 다음 용량 대비 비율 임계값.
  if (dep.remainingSeats <= LOW_STOCK_THRESHOLD) {
    return {
      label: `🔥 마감 임박 (${dep.remainingSeats}석)`,
      color: "bg-orange-100 text-orange-800",
    };
  }
  const ratio = Math.ceil(dep.capacity * badgeThreshold);
  if (dep.remainingSeats <= ratio)
    return { label: "마감 임박", color: "bg-orange-100 text-orange-800" };
  return null;
}

function isBookable(dep: Row): boolean {
  return (
    dep.remainingSeats > 0 &&
    dep.status !== "CLOSED" &&
    dep.status !== "CANCELED"
  );
}

function isLowStock(dep: Row): boolean {
  return (
    dep.remainingSeats > 0 &&
    dep.remainingSeats <= LOW_STOCK_THRESHOLD &&
    dep.status !== "CLOSED" &&
    dep.status !== "CANCELED"
  );
}

export function LiveDepartureList({
  productId,
  initialDepartures,
  badgeThreshold,
}: Props) {
  const [rows, setRows] = useState<Row[]>(initialDepartures);

  // 폴링 — POLL_INTERVAL_MS 주기로 lightweight 좌석 데이터만 fetch해 머지.
  // Frontend R2: cleanup(interval clear + fetch abort)으로 메모리 누수 방지.
  useEffect(() => {
    const ac = new AbortController();
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/products/${productId}/departures`, {
          signal: ac.signal,
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data: { departures: DepartureLiveSeat[] } = await res.json();
        if (cancelled) return;
        setRows((prev) =>
          prev.map((d) => {
            const fresh = data.departures.find((f) => f.id === d.id);
            if (!fresh) return d;
            // SSR이 알지 못하는 capacity 차이는 발생하지 않음(상품 정의 불변).
            // bookedSeats는 derived로만 보고 remainingSeats/status만 갱신.
            return {
              ...d,
              status: fresh.status,
              remainingSeats: fresh.remainingSeats,
              bookedSeats: fresh.capacity - fresh.remainingSeats,
            };
          })
        );
      } catch {
        // AbortError 또는 network — 다음 tick에서 재시도. 사용자 노출 0.
      }
    }

    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(interval);
    };
  }, [productId]);

  if (rows.length === 0) {
    return <EmptyState title="현재 모객 중인 출발일이 없습니다." />;
  }

  const grouped = groupByMonth(rows);
  const monthKeys = Object.keys(grouped).sort();

  return (
    <div className="space-y-8">
      {monthKeys.map((monthKey) => (
        <div key={monthKey}>
          <h3 className="mb-4 font-semibold text-gray-900">{monthKey}</h3>
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
                  <th className="px-4 py-3 text-center font-medium text-gray-700">
                    예약
                  </th>
                </tr>
              </thead>
              <tbody>
                {grouped[monthKey].map((dep) => {
                  const badge = getBadge(dep, badgeThreshold);
                  const bookable = isBookable(dep);
                  const lowStock = isLowStock(dep);
                  const formattedDate = new Date(
                    dep.departureDate
                  ).toLocaleDateString("ko-KR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                    weekday: "short",
                  });

                  return (
                    <tr
                      key={dep.id}
                      className="border-b border-gray-200 transition-colors hover:bg-gray-50"
                    >
                      <td className="px-4 py-3 text-gray-900">
                        <div>{formattedDate}</div>
                        {lowStock && (
                          <div className="mt-1 text-xs text-orange-700">
                            결제 진행 중인 고객이 있을 수 있습니다
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
                      <td className="px-4 py-3 text-center">
                        {bookable ? (
                          <Link
                            href={`/products/${productId}/checkout?departureId=${dep.id}`}
                            className="inline-block rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
                          >
                            예약하기
                          </Link>
                        ) : (
                          <button
                            type="button"
                            disabled
                            aria-disabled="true"
                            className="cursor-not-allowed rounded-lg bg-gray-200 px-4 py-1.5 text-xs font-semibold text-gray-500"
                          >
                            예약 마감
                          </button>
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
